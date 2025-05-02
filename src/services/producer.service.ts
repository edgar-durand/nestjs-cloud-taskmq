import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import { AddTaskOptions, AddTaskResult, ITask, TaskStatus } from '../interfaces/task.interface';
import { v4 as uuidv4 } from 'uuid';
import { CloudTaskMQConfig, QueueConfig } from '../interfaces/config.interface';

@Injectable()
export class ProducerService implements OnModuleInit {
  private readonly logger = new Logger(ProducerService.name);
  private client: CloudTasksClient;
  private queueConfigs: Map<string, QueueConfig> = new Map();
  private projectId: string;
  private location: string;
  private defaultProcessorUrl?: string;

  constructor(
    private readonly config: CloudTaskMQConfig,
    private readonly storageAdapter: IStateStorageAdapter,
  ) {
    this.client = new CloudTasksClient();
    this.projectId = config.projectId;
    this.location = config.location;
    this.defaultProcessorUrl = config.defaultProcessorUrl;
    
    // Configure queues
    for (const queueConfig of config.queues) {
      this.queueConfigs.set(queueConfig.name, queueConfig);
    }
  }

  /**
   * Initialize the producer service
   */
  async onModuleInit() {
    this.logger.log(`Initialized ProducerService with ${this.queueConfigs.size} queues`);

    try {
      // Validate all configured queues exist in GCP (or create them if autoCreateQueues is enabled)
      await this.validateQueues();

      // Log registered queues
      for (const [name, config] of this.queueConfigs.entries()) {
        this.logger.log(`Registered queue: ${name} -> ${config.path}`);
      }
    } catch (error) {
      this.logger.error(`Error during queue validation: ${error.message}`);
      throw error; // Re-throw to prevent app from starting with invalid queue config
    }
  }

  /**
   * Validate that all configured queues exist in GCP Cloud Tasks
   * If autoCreateQueues is enabled, creates missing queues
   */
  private async validateQueues(): Promise<void> {
    // Skip validation if no queues configured
    if (this.queueConfigs.size === 0) {
      this.logger.warn('No queues configured');
      return;
    }

    const parent = `projects/${this.projectId}/locations/${this.location}`;

    try {
      // List all existing queues
      const [existingQueues] = await this.client.listQueues({ parent });
      const existingQueuePaths = new Set(existingQueues.map(q => q.name));

      // Check each configured queue
      const missingQueues: QueueConfig[] = [];

      for (const [name, queueConfig] of this.queueConfigs.entries()) {
        if (!existingQueuePaths.has(queueConfig.path)) {
          missingQueues.push(queueConfig);
        }
      }

      // Handle missing queues
      if (missingQueues.length > 0) {
        if (this.config.autoCreateQueues) {
          // Create missing queues
          await this.createMissingQueues(missingQueues);
        } else {
          // Throw error listing all missing queues
          const missingQueueNames = missingQueues.map(q => q.name).join(', ');
          this.logger.error(new Error(
              `The following queues are configured but do not exist in GCP Cloud Tasks: ${missingQueueNames}. ` +
              `Either create these queues manually or set 'autoCreateQueues: true' in your CloudTaskMQModule configuration.`
          ));
        }
      } else {
        this.logger.log('All configured queues exist in GCP Cloud Tasks');
      }
    } catch (error) {
      if (error.code === 'PERMISSION_DENIED') {
        this.logger.warn(
            'Unable to list queues due to permission issues. Make sure your service account has ' +
            'cloudtasks.queues.list permission. Skipping queue validation.'
        );
      } else if (!error.message.includes('do not exist in GCP Cloud Tasks')) {
        // Re-throw if it's not our custom error about missing queues
        throw error;
      }
    }
  }

  /**
   * Create missing queues in GCP Cloud Tasks
   */
  private async createMissingQueues(missingQueues: QueueConfig[]): Promise<void> {
    for (const queueConfig of missingQueues) {
      try {
        // Extract queue name from path (last part after the last slash)
        const queueName = queueConfig.path.split('/').pop();
        const parent = `projects/${this.projectId}/locations/${this.location}`;

        this.logger.log(`Creating queue: ${queueConfig.name} in GCP Cloud Tasks`);

        // Create the queue
        await this.client.createQueue({
          parent,
          queue: {
            name: queueConfig.path,
          }
        });

        this.logger.log(`Successfully created queue: ${queueConfig.name}`);
      } catch (error) {
        this.logger.error(`Failed to create queue ${queueConfig.name}: ${error.message}`);
        throw new Error(`Failed to create queue ${queueConfig.name}: ${error.message}`);
      }
    }
  }

  /**
   * Add a task to a Cloud Tasks queue
   * 
   * @param queueName Name of the queue to add the task to
   * @param payload Data to be passed to the task handler
   * @param options Additional task options
   * @returns Result containing the task ID
   * 
   * @example
   * ```typescript
   * // Add a task to the email-queue
   * const result = await producerService.addTask('email-queue', {
   *   to: 'user@example.com',
   *   subject: 'Welcome!',
   *   body: 'Welcome to our platform.'
   * });
   * 
   * console.log(`Created task ${result.taskId}`);
   * ```
   */
  async addTask<T = any>(
    queueName: string,
    payload: T,
    options: AddTaskOptions = {},
  ): Promise<AddTaskResult> {
    // Get queue configuration
    const queueConfig = this.queueConfigs.get(queueName);
    if (!queueConfig) {
      throw new Error(`Queue '${queueName}' is not registered with CloudTaskMQ`);
    }

    // Clone the metadata to avoid modifying the original
    const taskMetadata = options.metadata ? { ...options.metadata } : {};

    // Add rate limiter key to metadata if provided
    if (options.rateLimiterKey) {
      taskMetadata.rateLimiterKey = options.rateLimiterKey;
    }

    // Add maxRetry to metadata if provided
    if (options.maxRetry) {
      taskMetadata.maxRetry = options.maxRetry;
    }
    
    // Generate a unique task ID
    const taskId = options.taskId || uuidv4();
    
    // Determine target URL for the task
    const targetUrl = queueConfig.processorUrl || this.defaultProcessorUrl;
    if (!targetUrl) {
      throw new Error(`No target URL configured for queue '${queueName}'`);
    }
    
    // Create task in Cloud Tasks
    const task: any = {
      httpRequest: {
        httpMethod: 'POST',
        url: targetUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({
          taskId,
          queueName,
          payload,
          metadata: taskMetadata,
        })).toString('base64'),
      },
    };

    // If a custom taskId was provided, set the name property
    if (options.taskId) {
      // Format: projects/PROJECT_ID/locations/LOCATION_ID/queues/QUEUE_ID/tasks/TASK_ID
      task.name = `projects/${this.projectId}/locations/${this.location}/queues/${queueName}/tasks/${options.taskId}`;
      this.logger.debug(`Using custom task name: ${task.name}`);
    }
    
    // Set schedule time if provided
    if (options.scheduleTime) {
      task.scheduleTime = {
        seconds: Math.floor(options.scheduleTime.getTime() / 1000),
        nanos: (options.scheduleTime.getTime() % 1000) * 1000000,
      };
    }
    
    // Set OIDC token if service account is configured
    if (queueConfig.serviceAccountEmail) {
      task.httpRequest.oidcToken = {
        serviceAccountEmail: queueConfig.serviceAccountEmail,
        audience: targetUrl,
      };
    }
    
    // Create the task in Cloud Tasks
    const [response] = await this.client.createTask({
      parent: queueConfig.path,
      task,
    });
    
    this.logger.debug(`Created Cloud Task: ${response.name}`);
    
    // Create a record in the storage adapter
    const taskRecord: Omit<ITask, 'createdAt' | 'updatedAt'> = {
      taskId,
      queueName,
      status: TaskStatus.IDLE,
      payload,
      metadata: {
        ...(options.metadata || {}),
        // Store cleanup options in metadata if provided
        ...(options.removeOnComplete !== undefined && { removeOnComplete: options.removeOnComplete }),
        ...(options.removeOnFail !== undefined && { removeOnFail: options.removeOnFail }),
      },
    };
    
    const savedTask = await this.storageAdapter.createTask(taskRecord);
    
    return {
      taskId: savedTask.taskId,
      queueName: savedTask.queueName,
      createdAt: savedTask.createdAt,
    };
  }

  /**
   * Get information about a specific task
   * 
   * @param taskId ID of the task to retrieve
   * @returns The task object or null if not found
   * 
   * @example
   * ```typescript
   * const task = await producerService.getTask('task-id-123');
   * if (task) {
   *   console.log(`Task status: ${task.status}`);
   * }
   * ```
   */
  async getTask(taskId: string): Promise<ITask | null> {
    return await this.storageAdapter.getTaskById(taskId);
  }

  /**
   * Find tasks matching specific criteria
   * 
   * @param queueName Filter by queue name (optional)
   * @param status Filter by task status (optional)
   * @param limit Maximum number of tasks to return
   * @param skip Number of tasks to skip (for pagination)
   * @returns Array of matching tasks
   * 
   * @example
   * ```typescript
   * // Get all failed tasks from the email-queue
   * const failedTasks = await producerService.findTasks('email-queue', TaskStatus.FAILED);
   * console.log(`Found ${failedTasks.length} failed email tasks`);
   * ```
   */
  async findTasks(
    queueName?: string,
    status?: TaskStatus,
    limit = 100,
    skip = 0,
  ): Promise<ITask[]> {
    return await this.storageAdapter.findTasks({
      queueName,
      status,
      limit,
      skip,
      sort: { createdAt: 'desc' },
    });
  }

  /**
   * Count tasks matching specific criteria
   * 
   * @param queueName Filter by queue name (optional)
   * @param status Filter by task status (optional)
   * @returns Count of matching tasks
   * 
   * @example
   * ```typescript
   * // Count active tasks across all queues
   * const activeCount = await producerService.countTasks(undefined, TaskStatus.ACTIVE);
   * console.log(`${activeCount} tasks are currently being processed`);
   * ```
   */
  async countTasks(
    queueName?: string,
    status?: TaskStatus,
  ): Promise<number> {
    return await this.storageAdapter.countTasks({
      queueName,
      status,
    });
  }

  /**
   * Get task counts grouped by status for a specific queue
   * 
   * @param queueName Name of the queue to get counts for
   * @returns Object with counts for each status
   * 
   * @example
   * ```typescript
   * const counts = await producerService.getQueueStatusCounts('email-queue');
   * console.log(`Queue status: ${counts.idle} idle, ${counts.active} active, ${counts.completed} completed, ${counts.failed} failed`);
   * ```
   */
  async getQueueStatusCounts(queueName: string): Promise<Record<TaskStatus, number>> {
    const result: Record<TaskStatus, number> = {
      [TaskStatus.IDLE]: 0,
      [TaskStatus.ACTIVE]: 0,
      [TaskStatus.COMPLETED]: 0,
      [TaskStatus.FAILED]: 0,
    };
    
    // Get counts for each status
    for (const status of Object.values(TaskStatus)) {
      result[status] = await this.storageAdapter.countTasks({
        queueName,
        status,
      });
    }
    
    return result;
  }
  /**
   * Generate a user-specific rate limiter key
   * This can be used to create per-user rate limits
   *
   * @param baseKey The base rate limiter key defined in config
   * @param userId The user ID to limit
   * @returns A user-specific rate limiter key
   */
  generateUserRateLimiterKey(baseKey: string, userId: string): string {
    return `${baseKey}:user:${userId}`;
  }
}

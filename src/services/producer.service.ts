import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import {
  AddTaskOptions,
  AddTaskResult,
  ITask,
  TaskStatus,
} from '../interfaces/task.interface';
import { v4 as uuidv4 } from 'uuid';
import { CloudTaskMQConfig, QueueConfig } from '../interfaces/config.interface';
import { GoogleAuth } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import {
  CLOUD_TASK_CONSUMER_KEY,
  CloudTaskConsumerOptions,
} from '../decorators/cloud-task-consumer.decorator';
import { DiscoveryService } from '@nestjs/core';
import { Interval } from '@nestjs/schedule';
import { google } from '@google-cloud/tasks/build/protos/protos';
import ICreateTaskRequest = google.cloud.tasks.v2.ICreateTaskRequest;

@Injectable()
export class ProducerService implements OnModuleInit {
  private readonly logger = new Logger(ProducerService.name);
  private client: CloudTasksClient;
  private queueConfigs: Map<string, QueueConfig> = new Map();
  private projectId: string;
  private location: string;
  private defaultProcessorUrl?: string;
  private controllerMetadata: Map<string, CloudTaskConsumerOptions> = new Map();

  private BUFFER_SIZE: number;

  constructor(
    private readonly config: CloudTaskMQConfig,
    private readonly storageAdapter: IStateStorageAdapter,
    private readonly configService: ConfigService,
    private readonly discoveryService: DiscoveryService,
  ) {
    this.client = new CloudTasksClient();
    this.projectId = config.projectId;
    this.location = config.location;
    this.defaultProcessorUrl = config.defaultProcessorUrl;

    // Configure queues
    for (const queueConfig of config.queues) {
      this.queueConfigs.set(queueConfig.name, queueConfig);
    }

    this.BUFFER_SIZE = 100 / config.queues.length;
  }

  /**
   * Initialize the producer service
   */
  async onModuleInit() {
    this.logger.log(
      `Initialized ProducerService with ${this.queueConfigs.size} queues`,
    );

    try {
      await this.discoverControllers();
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
   * Discover all controllers classes in the application
   */
  private async discoverControllers() {
    const controllers = this.discoveryService.getControllers();
    // Discover controllers with CloudTaskConsumer decorator
    for (const wrapper of controllers) {
      if (wrapper.instance) {
        const metadata = Reflect.getMetadata(
          CLOUD_TASK_CONSUMER_KEY,
          wrapper.instance.constructor,
        );

        if (metadata) {
          // Store metadata by queue name for quick lookup during task processing
          if (metadata.queues && Array.isArray(metadata.queues)) {
            for (const queue of metadata.queues) {
              this.controllerMetadata.set(queue, metadata);
            }
          } else {
            // If no specific queues, this controller handles all queues
            this.controllerMetadata.set('*', metadata);
          }
        }
      }
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
      const existingQueuePaths = new Set(existingQueues.map((q) => q.name));

      // Check each configured queue
      const missingQueues: QueueConfig[] = [];

      for (const [, queueConfig] of this.queueConfigs.entries()) {
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
          const missingQueueNames = missingQueues.map((q) => q.name).join(', ');
          this.logger.error(
            new Error(
              `The following queues are configured but do not exist in GCP Cloud Tasks: ${missingQueueNames}. ` +
                `Either create these queues manually or set 'autoCreateQueues: true' in your CloudTaskMQModule configuration.`,
            ),
          );
        }
      } else {
        this.logger.log('All configured queues exist in GCP Cloud Tasks');
      }
    } catch (error) {
      if (error.code === 'PERMISSION_DENIED') {
        this.logger.warn(
          'Unable to list queues due to permission issues. Make sure your service account has ' +
            'cloudtasks.queues.list permission. Skipping queue validation.',
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
  private async createMissingQueues(
    missingQueues: QueueConfig[],
  ): Promise<void> {
    for (const queueConfig of missingQueues) {
      try {
        const parent = `projects/${this.projectId}/locations/${this.location}`;

        this.logger.log(
          `Creating queue: ${queueConfig.name} in GCP Cloud Tasks`,
        );

        // Create the queue
        await this.client.createQueue({
          parent,
          queue: {
            name: queueConfig.path,
          },
        });

        this.logger.log(`Successfully created queue: ${queueConfig.name}`);
      } catch (error) {
        this.logger.error(
          `Failed to create queue ${queueConfig.name}: ${error.message}`,
        );
        throw new Error(
          `Failed to create queue ${queueConfig.name}: ${error.message}`,
        );
      }
    }
  }

  async sendTaskToGcp<T>(
    queueName: string,
    payload: T,
    options: AddTaskOptions = {},
  ) {
    // Get queue configuration
    const queueConfig = this.queueConfigs.get(queueName);
    if (!queueConfig) {
      throw new Error(
        `Queue '${queueName}' is not registered with CloudTaskMQ`,
      );
    }

    const taskId = options.taskId;

    // Determine target URL for the task
    const targetUrl = queueConfig.processorUrl || this.defaultProcessorUrl;
    if (!targetUrl) {
      throw new Error(`No target URL configured for queue '${queueName}'`);
    }

    options.audience ??= targetUrl;

    const authClient = new GoogleAuth();
    const credentials = await authClient.getCredentials();
    const serviceAccountEmail =
      queueConfig.serviceAccountEmail || credentials.client_email;

    // Check if OIDC token validation is enabled for this queue
    let useOidcToken = true; // Default to true for backward compatibility

    // Check controller metadata for this queue
    const queueMetadata =
      this.controllerMetadata?.get(queueName) ||
      this.controllerMetadata?.get('*');
    if (queueMetadata) {
      // If validateOidcToken is explicitly set to false, don't add OIDC token
      if (queueMetadata.includeOidcToken === false) {
        useOidcToken = false;
      }
    }

    if (!serviceAccountEmail && useOidcToken) {
      throw new Error(
        'Unable to resolve service-account e-mail for OIDC token. ' +
          'Provide `serviceAccountEmail` in queue config or supply credentials that expose `client_email`.',
      );
    }

    // Create task in Cloud Tasks
    const task: ICreateTaskRequest['task'] = {
      httpRequest: {
        httpMethod: 'POST',
        url: targetUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(
          JSON.stringify({
            taskId,
            queueName,
            payload,
            metadata: options,
          }),
        ).toString('base64'),
      },
    };

    // Add OIDC token only if validation is enabled
    if (useOidcToken) {
      task.httpRequest.oidcToken = {
        serviceAccountEmail,
        audience: options.audience,
      };
    }

    // If a custom taskId was provided, set the name property
    // if (options.taskId) {
    //   // Format: projects/PROJECT_ID/locations/LOCATION_ID/queues/QUEUE_ID/tasks/TASK_ID
    //   task.name = `projects/${this.projectId}/locations/${this.location}/queues/${queueName}/tasks/${options.taskId}`;
    //   this.logger.debug(`Using custom task name: ${task.name}`);
    // }

    // Set schedule time if provided
    if (options.scheduleTime) {
      const date = new Date(options.scheduleTime);
      task.scheduleTime = {
        seconds: Math.floor(date.getTime() / 1000),
        nanos: (date.getTime() % 1000) * 1000000,
      };
    }

    try {
      // Create the task in Cloud Tasks
      const [response] = await this.client.createTask({
        parent: queueConfig.path,
        task,
      });

      this.logger.verbose(`Created Cloud Task: ${response.name}`);
      return response;
    } catch (e) {
      this.logger.error(e);
      // set back to IDLE so it gets handled again
      await this.storageAdapter.updateTaskStatus(taskId, TaskStatus.IDLE, {});
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
      throw new Error(
        `Queue '${queueName}' is not registered with CloudTaskMQ`,
      );
    }

    // Clone the metadata to avoid modifying the original
    const taskMetadata = { ...options, ...options.metadata };

    if (
      typeof options.uniquenessKey === 'string' &&
      options.uniquenessKey !== 'undefined'
    ) {
      const existingKey = await this.storageAdapter.getUniquenessValue(
        options.uniquenessKey,
      );
      if (existingKey === true) {
        this.logger.warn({
          message: `Uniqueness key ${options.uniquenessKey} already exists. Skipping task creation.`,
        });
        return {
          taskId: null,
          queueName,
          createdAt: new Date(),
        };
      }
    }

    // Generate a unique task ID
    const taskId = options.taskId || uuidv4();

    // Create a record in the storage adapter
    const taskRecord: Omit<ITask, 'createdAt' | 'updatedAt'> = {
      taskId,
      queueName,
      status: TaskStatus.IDLE,
      payload,
      metadata: taskMetadata,
    };

    const savedTask = await this.storageAdapter.createTask(taskRecord);

    return {
      taskId: savedTask.taskId,
      queueName: savedTask.queueName,
      createdAt: savedTask.createdAt,
    };
  }

  /**
   * Periodically retrieves tasks from storage, processes them,
   * and sends them to the configured Google Cloud Platform (GCP) task queues.
   * This operation is performed at fixed intervals to handle buffered tasks effectively.
   *
   * 100 requests per second per project is the Rate Limit for GCP Cloud Task (API Calls)
   *
   * @return {Promise<void>} Resolves when all tasks have been processed and sent successfully.
   *                         Logs any errors encountered during the process.
   */
  @Interval(10_000)
  async sendBufferTasks(): Promise<void> {
    const queues = this.config.queues.map((q) => q.name);
    for (const queue of queues) {
      try {
        const tasks = await this.storageAdapter.findTasksWithoutActiveVersion({
          queueName: queue,
          status: TaskStatus.IDLE,
          limit: this.BUFFER_SIZE,
          sort: { updatedAt: 'asc' },
        });
        if (tasks.length > 0) {
          const promises = tasks.map(async (task) => {
            await this.storageAdapter.updateTaskStatus(
              task.taskId,
              TaskStatus.ACTIVE,
              {},
            );
            await this.sendTaskToGcp(
              task.queueName,
              task.payload,
              task.metadata as AddTaskOptions,
            );
          });
          await Promise.all(promises);
        }
      } catch (e) {
        this.logger.error(e);
      }
    }
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
  async countTasks(queueName?: string, status?: TaskStatus): Promise<number> {
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
  async getQueueStatusCounts(
    queueName: string,
  ): Promise<Record<TaskStatus, number>> {
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
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import {
  PROCESSOR_METADATA_KEY,
  PROCESSOR_QUEUE_KEY,
  ProcessorOptions,
} from '../decorators/processor.decorator';
import {
  PROCESS_METHOD_KEY,
  ProcessOptions,
} from '../decorators/process.decorator';
import {
  ON_TASK_ACTIVE_KEY,
  ON_TASK_COMPLETED_KEY,
  ON_TASK_FAILED_KEY,
  ON_TASK_PROGRESS_KEY,
} from '../decorators/events.decorator';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import { AddTaskOptions, TaskStatus } from '../interfaces/task.interface';
import { CloudTask } from '../models/cloud-task.model';
import {
  CloudTaskMQConfig,
  RateLimiterOptions,
} from '../interfaces/config.interface';
import {
  CLOUD_TASK_CONSUMER_KEY,
  CloudTaskConsumerOptions,
} from '../decorators/cloud-task-consumer.decorator';
import { RateLimiterService } from './rate-limiter.service';
import { ProducerService } from './producer.service';
import * as crypto from 'node:crypto';

/**
 * Structure to hold discovered task processors
 */
interface TaskProcessorMetadata {
  // The instance of the processor class
  instance: any;

  // Queue name the processor handles
  queueName: string;

  // Method that processes tasks
  processMethod: string;

  // Process method options
  processOptions: ProcessOptions;

  // Event handler methods
  onActive?: string;
  onCompleted?: string;
  onFailed?: string;
  onProgress?: string;

  // Processor options
  options: ProcessorOptions;
}

@Injectable()
export class ConsumerService implements OnModuleInit {
  private readonly logger = new Logger(ConsumerService.name);
  private processors: Map<string, TaskProcessorMetadata> = new Map();
  private controllerMetadata: Map<string, CloudTaskConsumerOptions> = new Map();
  private workerId: string;
  private lockDurationMs: number;

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
    private readonly config: CloudTaskMQConfig,
    private readonly storageAdapter: IStateStorageAdapter,
    private readonly rateLimiterService: RateLimiterService,
    private readonly producerService: ProducerService,
  ) {
    // Generate a unique worker ID for this instance
    this.workerId = `worker-${crypto.randomUUID()}`;
    this.lockDurationMs = config.lockDurationMs || 60000; // 60 seconds default
  }

  /**
   * Initialize the consumer service by discovering all processor classes
   */
  async onModuleInit() {
    await this.discoverProcessors();
    await this.discoverControllers();
    this.logger.log(
      `Initialized ConsumerService with workerId ${this.workerId}`,
    );
    this.logger.log(`Discovered ${this.processors.size} task processors`);

    // Log discovered processors
    for (const [queueName, metadata] of this.processors.entries()) {
      this.logger.log(
        `Processor for queue '${queueName}': ${metadata.instance.constructor.name}.${metadata.processMethod}`,
      );
    }
  }

  /**
   * Discover all processor classes in the application
   */
  private async discoverProcessors() {
    // Discover all providers in the application
    const providers = this.discoveryService.getProviders();

    // Filter providers that have the @Processor decorator
    const processorProviders = providers.filter((wrapper) =>
      this.isProcessor(wrapper),
    );

    // Process each processor provider
    for (const wrapper of processorProviders) {
      const instance = wrapper.instance;
      const prototype = Object.getPrototypeOf(instance);

      if (!instance || !prototype) {
        continue;
      }

      // Get queue name and processor options from metadata
      const queueName = Reflect.getMetadata(
        PROCESSOR_QUEUE_KEY,
        instance.constructor,
      );
      const processorOptions =
        Reflect.getMetadata(PROCESSOR_METADATA_KEY, instance.constructor) || {};

      if (!queueName) {
        continue;
      }

      // Scan methods of the processor class for handlers
      const methodNames = this.metadataScanner.getAllMethodNames(prototype);
      let processMethod: string = null;
      let processOptions: ProcessOptions = {};
      let onActive: string = null;
      let onCompleted: string = null;
      let onFailed: string = null;
      let onProgress: string = null;

      // Find process method and event handlers
      for (const methodName of methodNames) {
        const handler = instance[methodName];

        // Check if method is a process handler
        const processMetadata = Reflect.getMetadata(
          PROCESS_METHOD_KEY,
          handler,
        );
        if (processMetadata) {
          processMethod = methodName;
          processOptions = processMetadata;
        }

        // Check if method is an event handler
        if (Reflect.getMetadata(ON_TASK_ACTIVE_KEY, handler)) {
          onActive = methodName;
        }
        if (Reflect.getMetadata(ON_TASK_COMPLETED_KEY, handler)) {
          onCompleted = methodName;
        }
        if (Reflect.getMetadata(ON_TASK_FAILED_KEY, handler)) {
          onFailed = methodName;
        }
        if (Reflect.getMetadata(ON_TASK_PROGRESS_KEY, handler)) {
          onProgress = methodName;
        }
      }

      // Register the processor if it has a process method
      if (processMethod) {
        this.processors.set(queueName, {
          instance,
          queueName,
          processMethod,
          processOptions,
          onActive,
          onCompleted,
          onFailed,
          onProgress,
          options: processorOptions,
        });
      } else {
        this.logger.warn(
          `Processor for queue '${queueName}' has no @Process method`,
        );
      }
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
              this.logger.debug(
                `Found controller for queue '${queue}' with metadata: ${JSON.stringify(
                  metadata,
                )}`,
              );
            }
          } else {
            // If no specific queues, this controller handles all queues
            this.controllerMetadata.set('*', metadata);
            this.logger.debug(
              `Found controller for all queues with metadata: ${JSON.stringify(
                metadata,
              )}`,
            );
          }
        }
      }
    }
  }

  /**
   * Check if an instance wrapper has the @Processor decorator
   */
  private isProcessor(wrapper: InstanceWrapper): boolean {
    const { instance } = wrapper;
    if (!instance) {
      return false;
    }

    return !!Reflect.getMetadata(PROCESSOR_QUEUE_KEY, instance.constructor);
  }

  /**
   * Get rate limiter options based on the task's rateLimiterKey
   * Looks through all configured rate limiters to find one matching the key
   * Also supports dynamic rate limiters registered at runtime
   *
   * @param queueName The queue name
   * @param rateLimiterKey The rate limiter key from the task
   * @returns Matching rate limiter options or null
   */
  private getRateLimiterOptions(
    queueName: string,
    rateLimiterKey?: string,
  ): RateLimiterOptions | string | null {
    if (!rateLimiterKey) {
      return null; // No rate limiting if key not provided
    }

    // First check controller-level rate limiters (highest priority)
    const queueMetadata =
      this.controllerMetadata?.get(queueName) ||
      this.controllerMetadata?.get('*');
    if (queueMetadata?.rateLimiterOptions) {
      // Find a matching limiter by key
      if (Array.isArray(queueMetadata.rateLimiterOptions)) {
        const matchingLimiter = queueMetadata.rateLimiterOptions.find(
          (limiter) => limiter.limiterKey === rateLimiterKey,
        );

        if (matchingLimiter) {
          return matchingLimiter;
        }
      } else if (
        (queueMetadata.rateLimiterOptions as RateLimiterOptions).limiterKey ===
        rateLimiterKey
      ) {
        return queueMetadata.rateLimiterOptions as RateLimiterOptions;
      }
    }

    // Then check queue-specific rate limiters
    const queueConfig = this.config.queues.find((q) => q.name === queueName);
    if (queueConfig?.rateLimiterOptions) {
      const matchingLimiter = queueConfig.rateLimiterOptions.find(
        (limiter) => limiter.limiterKey === rateLimiterKey,
      );

      if (matchingLimiter) {
        return matchingLimiter;
      }
    }

    // Finally, check if this is a dynamic limiter key
    // For dynamic limiters, we just return the key string and let the RateLimiterService handle it
    if (rateLimiterKey && rateLimiterKey.includes(':')) {
      // Only mark it as a dynamic limiter if we have a RateLimiterService available
      if (this.rateLimiterService) {
        return rateLimiterKey;
      }
    }

    return null;
  }

  /**
   * Re-enqueue a task with a delay when it hits a rate limit
   * This uses the Cloud Tasks native scheduling feature to retry the task later
   */
  private async reEnqueueTaskWithDelay(
    taskId: string,
    queueName: string,
    payload: any,
    metadata: any,
    waitTimeMs: number,
  ) {
    try {
      // First, get the original task to check if it's a retry
      const originalTask = await this.storageAdapter.getTaskById(taskId);

      // Release the current lock
      await this.storageAdapter.releaseTaskLock(taskId, this.workerId);
      if (
        typeof originalTask?.metadata.uniquenessKey === 'string' &&
        originalTask?.metadata?.uniquenessKey !== 'undefined'
      ) {
        await this.storageAdapter.removeUniquenessKey(
          originalTask?.metadata?.uniquenessKey,
        );
      }

      let retryCount = 0;

      // Check if this task already has retry information
      if (originalTask?.metadata?.retryHistory) {
        retryCount = originalTask.metadata.retryCount || 0;
      }

      // Increment retry count
      retryCount++;

      // Determine max retries (default to 5 if not specified)
      // Check for maxRetry in the task's metadata
      const maxRetry =
        metadata?.maxRetry ?? originalTask?.metadata?.maxRetry ?? 5;

      // Check if we've exceeded max retries
      if (retryCount > maxRetry) {
        this.logger.warn(
          `Task ${taskId} has exceeded maximum retries (${maxRetry}). Marking as failed.`,
        );

        // Update the task status to failed
        await this.storageAdapter.updateTaskStatus(taskId, TaskStatus.FAILED, {
          metadata: {
            ...originalTask?.metadata,
            ...metadata,
            originalTaskId: taskId,
            retryCount: retryCount - 1, // Don't count this attempt since we're not retrying
            retryHistory: [
              ...(originalTask?.metadata?.retryHistory || []),
              {
                timestamp: new Date(),
                waitTimeMs: 0,
                reason: 'max-retries-exceeded',
              },
            ],
          },
          failureReason: `Rate limit exceeded after ${
            retryCount - 1
          } retries (maximum: ${maxRetry})`,
        });
        return;
      }

      // Calculate new schedule time
      const scheduleTime = new Date(Date.now() + (waitTimeMs ?? 0));

      // Get or create retry history
      const retryHistory = metadata?.retryHistory || [];
      retryHistory.push({
        timestamp: new Date(),
        waitTimeMs,
        reason: 'rate-limited',
      });

      // Prepare retry metadata
      const updatedMetadata = {
        removeOnComplete: 60 * 60 * 24 * 30,
        removeOnFail: 60 * 60 * 24 * 30,
        ...originalTask?.metadata,
        ...metadata,
        originalTaskId: taskId,
        retryCount,
        maxRetry,
        retryHistory,
        scheduleTime,
      };

      const additionalData: AddTaskOptions = {
        ...updatedMetadata,
        taskId,
        maxRetry,
      };

      // Update the task status to reflect that it's been rescheduled
      await this.storageAdapter.updateTaskStatus(
        taskId,
        TaskStatus.IDLE,
        additionalData,
      );

      // Create a new delayed task in Cloud Tasks (the original document is reused)
      const task = await this.producerService.addTask(
        queueName,
        payload,
        additionalData,
      );

      return task;
    } catch (error) {
      this.logger.error(error, {
        message: `Failed to re-enqueue rate-limited task: ${error.message}`,
      });
    }
  }

  /**
   * Process a task received from Cloud Tasks
   *
   * @param taskId ID of the task
   * @param queueName Name of the queue
   * @param payload Task payload
   * @param metadata Additional task metadata
   * @returns Result of the task processing
   */
  async processTask(
    taskId: string,
    queueName: string,
    payload: any,
    metadata?: Record<string, any>,
  ): Promise<any> {
    // Extract rate limiter key from metadata
    const taskMetadata: Partial<AddTaskOptions> = metadata;
    const rateLimiterKey = taskMetadata?.rateLimiterKey;
    const uniquenessKey = taskMetadata?.uniquenessKey;
    const shouldHandleUniqueness =
      !!uniquenessKey &&
      typeof uniquenessKey === 'string' &&
      uniquenessKey !== 'undefined';

    // Update task status to ACTIVE
    let taskRecord = await this.storageAdapter.getTaskById(taskId);
    // Find or create the task record
    if (!taskRecord) {
      // If task doesn't exist in storage, ignore
      this.logger.error(new Error(`Task not found in storage: ${taskId}`));
      return;
    }

    taskRecord = await this.storageAdapter.updateTaskStatus(
      taskId,
      TaskStatus.ACTIVE,
      { startedAt: new Date() },
    );

    if (shouldHandleUniqueness) {
      const existingUniqueness = await this.storageAdapter.getUniquenessValue(
        uniquenessKey,
      );
      if (existingUniqueness === true) {
        this.logger.warn({
          message: `Uniqueness key ${uniquenessKey} exists. Skipping task.`,
        });
        return;
      } else {
        try {
          await this.storageAdapter.saveUniquenessKey(uniquenessKey);
        } catch {
          try {
            await this.storageAdapter.failTask(
              taskId,
              `Uniqueness key ${uniquenessKey} already exists`,
            );
          } catch {}
          return;
        }
      }
    }

    // Get rate limiter options based on the key
    const rateLimiterOptions = this.getRateLimiterOptions(
      queueName,
      rateLimiterKey,
    );

    // Check rate limiter if configured and we have a matching key
    if (rateLimiterOptions && rateLimiterKey) {
      const canProcess = await this.rateLimiterService.tryConsume(
        rateLimiterOptions,
      );

      if (!canProcess) {
        // Calculate wait time
        const waitTimeMs = await this.rateLimiterService.getWaitTimeMs(
          rateLimiterOptions,
        );

        // Implement progressive backoff for repeat rate limiting
        let adjustedWaitTimeMs = waitTimeMs;
        const retryCount = metadata?.retryCount || 0;
        if (retryCount > 0) {
          // Exponential backoff with a maximum delay cap
          const backoffFactor = Math.min(Math.pow(2, retryCount - 1), 10);
          adjustedWaitTimeMs = Math.min(waitTimeMs * backoffFactor, 900_000); // Cap at 15 mins
        }
        let reEnqueuedSuccessfully = false;
        try {
          if (shouldHandleUniqueness) {
            await this.storageAdapter.removeUniquenessKey(uniquenessKey);
          }

          // Re-enqueue task with delay
          const createdTask = await this.reEnqueueTaskWithDelay(
            taskId,
            queueName,
            payload,
            metadata,
            adjustedWaitTimeMs,
          );
          reEnqueuedSuccessfully = !!createdTask?.taskId;
        } catch (error) {
          this.logger.error(error, {
            message: `Error during re-enqueue for rate-limited task ${taskId}: ${error.message}.`,
          });
          reEnqueuedSuccessfully = false;
        }
        if (!reEnqueuedSuccessfully) {
          const errorMessage = `Failed to re-enqueue rate-limited task ${taskId} for queue ${queueName}. Original task should be NACKed or will time out and be redelivered.`;
          // Throw an error to ensure the original message is NACKed and redelivered by Cloud Tasks
          throw new Error(errorMessage);
        }
        return;
      }
    }

    // Find the appropriate processor for this queue
    const processor = this.processors.get(queueName);
    if (!processor) {
      throw new Error(`No processor found for queue '${queueName}'`);
    }

    // Determine the lock duration to use with priority:
    // 1. Controller-level setting (if provided)
    // 2. Queue-specific setting (if exists)
    // 3. Global default
    let lockDurationMs = this.lockDurationMs; // Start with global default

    // Check for queue-specific lock duration
    const queueConfig = this.config.queues.find((q) => q.name === queueName);
    if (queueConfig && typeof queueConfig.lockDurationMs === 'number') {
      lockDurationMs = queueConfig.lockDurationMs;
    }

    // Look up controller metadata for this queue
    const queueMetadata =
      this.controllerMetadata?.get(queueName) ||
      this.controllerMetadata?.get('*');

    // Controller-level setting takes the highest priority
    if (queueMetadata && typeof queueMetadata.lockDurationMs === 'number') {
      lockDurationMs = queueMetadata.lockDurationMs;
    }

    // Attempt to acquire a lock on the task with retries
    let lockAcquired = false;
    let retryCount = 0;
    const maxLockRetries = 3;
    const lockRetryDelayMs = 500;

    while (!lockAcquired && retryCount < maxLockRetries) {
      lockAcquired = await this.storageAdapter.acquireTaskLock(
        taskId,
        this.workerId,
        lockDurationMs,
      );

      if (!lockAcquired) {
        retryCount++;
        if (retryCount < maxLockRetries) {
          await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
        }
      }
    }

    if (!lockAcquired) {
      this.logger.warn({
        message: `Could not acquire lock for task ${taskId} after ${maxLockRetries} attempts - it may be processed by another worker`,
      });
      await this.storageAdapter.failTask(taskId, 'LOCK_FAILED');
      return { success: false, reason: 'LOCK_FAILED' };
    }

    // Create CloudTask instance
    const cloudTask = new CloudTask(taskRecord);

    // Set up progress reporting
    if (processor.onProgress) {
      cloudTask.setProgressReporter(async (progress: number) => {
        try {
          // Call onProgress handler
          await processor.instance[processor.onProgress](cloudTask, progress);
        } catch (error) {
          this.logger.error(error, {
            message: `Error in progress event handler: ${error.message}`,
          });
        }
      });
    }

    try {
      // Call onActive handler if it exists
      if (processor.onActive) {
        try {
          await processor.instance[processor.onActive](cloudTask);
        } catch (error) {
          this.logger.error(error, {
            message: `Error in task active event handler: ${error.message}`,
          });
        }
      }

      // Process the task
      const result = await processor.instance[processor.processMethod](
        cloudTask,
      );

      await this.storageAdapter.completeTask(taskId, result);

      // Call onCompleted handler if it exists
      if (processor.onCompleted) {
        try {
          await processor.instance[processor.onCompleted](cloudTask, result);
        } catch (error) {
          this.logger.error(error, {
            message: `Error in task completed event handler: ${error.message}`,
          });
        }
      }

      return { success: true, result };
    } catch (error) {
      // Handle task processing error
      const failureReason = error.message || 'Unknown error';
      await this.storageAdapter.failTask(taskId, failureReason);

      if (shouldHandleUniqueness) {
        await this.storageAdapter.removeUniquenessKey(uniquenessKey);
      }
      // Call onFailed handler if it exists
      if (processor.onFailed) {
        try {
          await processor.instance[processor.onFailed](cloudTask, error);
        } catch (handlerError) {
          this.logger.error(handlerError, {
            message: `Error in task failed event handler: ${handlerError.message}`,
          });
        }
      }

      // Get the maxRetry value from metadata or use default
      const maxRetry = metadata?.maxRetry ?? 5; // Default to 5 if not specified
      const currentRetryCount = (taskRecord.retryCount || 0) + 1;

      // Only re-throw the error (causing Cloud Tasks to retry) if we haven't exceeded maxRetry
      if (currentRetryCount <= maxRetry) {
        this.logger.debug({
          message: `Retry ${currentRetryCount}/${maxRetry} for task ${taskId}`,
        });
        // Persist the incremented retry count before throwing
        await this.storageAdapter.failTask(taskId, failureReason);
        throw error;
      } else {
        const message = `Task ${taskId} exceeded maximum retry attempts (${maxRetry}). Not retrying.`;
        this.logger.warn({ message });
        await this.storageAdapter.failTask(taskId, message);
        return { success: false, error: failureReason, maxRetryExceeded: true };
      }
    }
  }
}

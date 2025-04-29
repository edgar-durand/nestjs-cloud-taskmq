import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { 
  PROCESSOR_QUEUE_KEY, 
  PROCESSOR_METADATA_KEY, 
  ProcessorOptions 
} from '../decorators/processor.decorator';
import { 
  PROCESS_METHOD_KEY, 
  ProcessOptions 
} from '../decorators/process.decorator';
import {
  ON_QUEUE_ACTIVE_KEY,
  ON_QUEUE_COMPLETED_KEY,
  ON_QUEUE_FAILED_KEY,
  ON_QUEUE_PROGRESS_KEY,
} from '../decorators/events.decorator';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import { ITask, TaskStatus } from '../interfaces/task.interface';
import { CloudTask } from '../models/cloud-task.model';
import { CloudTaskMQConfig } from '../interfaces/config.interface';

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
  private workerId: string;
  private lockDurationMs: number;

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
    private readonly config: CloudTaskMQConfig,
    private readonly storageAdapter: IStateStorageAdapter,
  ) {
    // Generate a unique worker ID for this instance
    this.workerId = `worker-${Math.random().toString(36).substring(2, 15)}`;
    this.lockDurationMs = config.lockDurationMs || 60000; // 60 seconds default
  }

  /**
   * Initialize the consumer service by discovering all processor classes
   */
  async onModuleInit() {
    await this.discoverProcessors();
    this.logger.log(`Initialized ConsumerService with workerId ${this.workerId}`);
    this.logger.log(`Discovered ${this.processors.size} task processors`);
    
    // Log discovered processors
    for (const [queueName, metadata] of this.processors.entries()) {
      this.logger.log(`Processor for queue '${queueName}': ${metadata.instance.constructor.name}.${metadata.processMethod}`);
    }
  }

  /**
   * Discover all processor classes in the application
   */
  private async discoverProcessors() {
    // Discover all providers in the application
    const providers = this.discoveryService.getProviders();
    
    // Filter providers that have the @Processor decorator
    const processorProviders = providers.filter(wrapper => this.isProcessor(wrapper));
    
    // Process each processor provider
    for (const wrapper of processorProviders) {
      const instance = wrapper.instance;
      const prototype = Object.getPrototypeOf(instance);
      
      if (!instance || !prototype) {
        continue;
      }
      
      // Get queue name and processor options from metadata
      const queueName = Reflect.getMetadata(PROCESSOR_QUEUE_KEY, instance.constructor);
      const processorOptions = Reflect.getMetadata(PROCESSOR_METADATA_KEY, instance.constructor) || {};
      
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
        const processMetadata = Reflect.getMetadata(PROCESS_METHOD_KEY, handler);
        if (processMetadata) {
          processMethod = methodName;
          processOptions = processMetadata;
        }
        
        // Check if method is an event handler
        if (Reflect.getMetadata(ON_QUEUE_ACTIVE_KEY, handler)) {
          onActive = methodName;
        }
        if (Reflect.getMetadata(ON_QUEUE_COMPLETED_KEY, handler)) {
          onCompleted = methodName;
        }
        if (Reflect.getMetadata(ON_QUEUE_FAILED_KEY, handler)) {
          onFailed = methodName;
        }
        if (Reflect.getMetadata(ON_QUEUE_PROGRESS_KEY, handler)) {
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
        this.logger.warn(`Processor for queue '${queueName}' has no @Process method`);
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
    // Find the appropriate processor for this queue
    const processor = this.processors.get(queueName);
    if (!processor) {
      throw new Error(`No processor found for queue '${queueName}'`);
    }
    
    // Find or create the task record
    let taskRecord = await this.storageAdapter.getTaskById(taskId);
    if (!taskRecord) {
      // If task doesn't exist in storage, create it
      const newTask: Omit<ITask, 'createdAt' | 'updatedAt'> = {
        taskId,
        queueName,
        status: TaskStatus.IDLE,
        payload,
        metadata,
      };
      taskRecord = await this.storageAdapter.createTask(newTask);
    }
    
    // Attempt to acquire a lock on the task
    const lockAcquired = await this.storageAdapter.acquireTaskLock(
      taskId,
      this.workerId,
      this.lockDurationMs,
    );
    
    if (!lockAcquired) {
      this.logger.warn(`Could not acquire lock for task ${taskId} - it may be processed by another worker`);
      return { success: false, reason: 'LOCK_FAILED' };
    }
    
    // Update task status to ACTIVE
    taskRecord = await this.storageAdapter.updateTaskStatus(
      taskId,
      TaskStatus.ACTIVE,
      { startedAt: new Date() },
    );
    
    // Create CloudTask instance
    const cloudTask = new CloudTask(taskRecord);
    
    // Set up progress reporting
    if (processor.onProgress) {
      cloudTask.setProgressReporter(async (progress: number) => {
        try {
          // Call onProgress handler
          await processor.instance[processor.onProgress](cloudTask, progress);
        } catch (error) {
          this.logger.error(`Error in progress event handler: ${error.message}`, error.stack);
        }
      });
    }
    
    try {
      // Call onActive handler if it exists
      if (processor.onActive) {
        try {
          await processor.instance[processor.onActive](cloudTask);
        } catch (error) {
          this.logger.error(`Error in task active event handler: ${error.message}`, error.stack);
        }
      }
      
      // Process the task
      const result = await processor.instance[processor.processMethod](cloudTask);
      
      // Update task status to COMPLETED
      await this.storageAdapter.updateTaskStatus(
        taskId,
        TaskStatus.COMPLETED,
        { 
          completedAt: new Date(),
          // Release the lock
          lockedUntil: undefined,
          workerId: undefined, 
        },
      );
      
      // Call onCompleted handler if it exists
      if (processor.onCompleted) {
        try {
          await processor.instance[processor.onCompleted](cloudTask, result);
        } catch (error) {
          this.logger.error(`Error in task completed event handler: ${error.message}`, error.stack);
        }
      }
      
      return { success: true, result };
    } catch (error) {
      // Handle task processing error
      const failureReason = error.message || 'Unknown error';
      
      // Update task status to FAILED
      await this.storageAdapter.updateTaskStatus(
        taskId,
        TaskStatus.FAILED,
        { 
          failureReason,
          // Release the lock
          lockedUntil: undefined,
          workerId: undefined,
          // Increment retry count
          retryCount: (taskRecord.retryCount || 0) + 1, 
        },
      );
      
      // Call onFailed handler if it exists
      if (processor.onFailed) {
        try {
          await processor.instance[processor.onFailed](cloudTask, error);
        } catch (handlerError) {
          this.logger.error(`Error in task failed event handler: ${handlerError.message}`, handlerError.stack);
        }
      }
      
      // Log the error
      this.logger.error(`Error processing task ${taskId}: ${failureReason}`, error.stack);
      
      // Re-throw the error to let Cloud Tasks handle the retry policy
      throw error;
    }
  }
}

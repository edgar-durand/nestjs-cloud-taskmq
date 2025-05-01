import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Schema } from 'mongoose';
import { IStateStorageAdapter, TaskQueryOptions } from '../interfaces/storage-adapter.interface';
import { ITask, TaskStatus } from '../interfaces/task.interface';

/**
 * MongoDB schema for task documents
 */
export const TaskSchema = new Schema<ITask>(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    queueName: { type: String, required: true, index: true },
    status: { 
      type: String, 
      enum: Object.values(TaskStatus), 
      default: TaskStatus.IDLE, 
      index: true 
    },
    payload: { type: Schema.Types.Mixed, required: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failureReason: { type: String },
    retryCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    workerId: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
    expireAt: { type: Date },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    collection: 'cloud_taskmq_tasks',
  }
);

@Injectable()
export class MongoStorageAdapter implements IStateStorageAdapter {
  private readonly logger = new Logger(MongoStorageAdapter.name);
  private collectionName: string;
  private taskModel: Model<ITask>;

  constructor(
      @InjectConnection() private connection?: Connection,
      @InjectModel('CloudTaskMQTask') private injectedModel?: Model<ITask>,
      private customCollectionName?: string
  ) {
    this.logger.debug(`MongoStorageAdapter constructor called with: connection=${!!this.connection}, model=${!!this.injectedModel}, collectionName=${this.customCollectionName}`);

    // If the model is directly injected, use it
    if (this.injectedModel) {
      this.logger.debug('Using injected model');
      this.taskModel = this.injectedModel;
      this.collectionName = this.taskModel.collection.name;
      return;
    }

    // If we have a connection but no model, create the model
    if (this.connection) {
      const collName = this.customCollectionName || 'cloud_taskmq_tasks';
      this.logger.debug(`Using connection to create model with collection: ${collName}`);

      // Check if the model already exists on this connection
      if (this.connection.models['CloudTaskMQTask']) {
        this.logger.debug('Model already exists on connection, reusing it');
        this.taskModel = this.connection.models['CloudTaskMQTask'];
      } else {
        this.logger.debug('Creating new model with schema');
        // Create a new model with our schema
        this.taskModel = this.connection.model<ITask>(
            'CloudTaskMQTask',
            TaskSchema,
            collName
        );
      }

      this.collectionName = collName;
    } else {
      this.logger.warn('MongoStorageAdapter created without connection or model!');
    }
  }

  /**
   * Initialize the MongoDB storage adapter
   */
  async initialize(): Promise<void> {
    this.logger.debug(`Initializing MongoStorageAdapter: taskModel=${!!this.taskModel}, collectionName=${this.collectionName}`);

    if (!this.taskModel) {
      const error = 'MongoStorageAdapter failed to initialize: No model or connection provided';
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      const collName = this.taskModel.collection.name;

      // Create indexes on the collection
      // Using the model's schema to ensure indexes
      const indexCreationPromises = [
        this.taskModel.collection.createIndex({ taskId: 1 }, { unique: true }),
        this.taskModel.collection.createIndex({ queueName: 1, status: 1 }),
        this.taskModel.collection.createIndex({ status: 1 }),
        this.taskModel.collection.createIndex({ createdAt: 1 }),
        this.taskModel.collection.createIndex({ lockedUntil: 1 }, { sparse: true }),
      ];

      // Verify the index exists
      const indexes = await this.taskModel.collection.indexes();
      const ttlIndex = indexes.find(idx => idx.key && idx.key.expireAt === 1);

      if (!ttlIndex) {
        // Create the TTL index explicitly
        const ttlIndexOptions = {
          expireAfterSeconds: 0,
          sparse: true,
          background: true,
          name: 'expireAt_ttl_index'
        };
        // Directly create TTL index on MongoDB collection
        await this.taskModel.collection.createIndex(
            { expireAt: 1 },
            ttlIndexOptions
        );
        this.logger.log('TTL index created successfully in async configuration');
      } else {
        this.logger.log('TTL index already exists, skipping creation');
      }

      const indexCreationResults = await Promise.all(indexCreationPromises);
      this.logger.log(`Created ${indexCreationResults.length} indexes on ${collName}`);
      if (ttlIndex) {
        this.logger.log(`TTL index successfully created: ${JSON.stringify(ttlIndex)}`);
      } else {
        this.logger.warn(`Failed to create TTL index on expireAt field. Automatic document cleanup may not work.`);
      }

      // Verify the model is working by trying to access the collection
      this.logger.log(`Initialized MongoStorageAdapter with collection: ${collName}`);
    } catch (err) {
      this.logger.error(`Error accessing MongoDB collection: ${err.message}`);
      throw err;
    }
  }

  /**
   * Create a new task record in MongoDB
   */
  async createTask(task: Omit<ITask, 'createdAt' | 'updatedAt'>): Promise<ITask> {
    const newTask = new this.taskModel(task);
    return await newTask.save();
  }

  /**
   * Get a task by its ID
   */
  async getTaskById(taskId: string): Promise<ITask | null> {
    return await this.taskModel.findOne({ taskId }).exec();
  }

  /**
   * Update task status and additional fields
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    additionalData?: Partial<ITask>,
  ): Promise<ITask | null> {
    const updateData: any = { status, ...additionalData };
    
    // Add timestamps based on status
    if (status === TaskStatus.ACTIVE) {
      updateData.startedAt = new Date();
    } else if (status === TaskStatus.COMPLETED) {
      updateData.completedAt = new Date();
    }
    
    return await this.taskModel.findOneAndUpdate(
      { taskId },
      { $set: updateData },
      { new: true },
    ).exec();
  }

  /**
   * Acquire a lock on a task for processing
   */
  async acquireTaskLock(
    taskId: string,
    workerId: string,
    lockDurationMs: number,
  ): Promise<boolean> {
    const lockedUntil = new Date(Date.now() + lockDurationMs);
    
    const result = await this.taskModel.findOneAndUpdate(
      {
        taskId,
        $or: [
          { lockedUntil: { $exists: false } },
          { lockedUntil: { $lt: new Date() } },
        ],
      },
      {
        $set: {
          lockedUntil,
          workerId,
          status: TaskStatus.ACTIVE,
          startedAt: new Date(),
        },
      },
      { new: true },
    ).exec();
    
    return !!result;
  }

  /**
   * Release a lock on a task
   */
  async releaseTaskLock(taskId: string, workerId: string): Promise<boolean> {
    const result = await this.taskModel.findOneAndUpdate(
      { taskId, workerId },
      {
        $unset: {
          lockedUntil: 1,
          workerId: 1,
        },
      },
      { new: true },
    ).exec();
    
    return !!result;
  }

  /**
   * Find tasks matching the given criteria
   */
  async findTasks(options: TaskQueryOptions): Promise<ITask[]> {
    const { status, queueName, skip = 0, limit = 100, sort = { createdAt: 'desc' } } = options;
    
    const query: any = {};
    if (status) {
      query.status = status;
    }
    if (queueName) {
      query.queueName = queueName;
    }
    
    return await this.taskModel
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .exec();
  }

  /**
   * Count tasks matching the given criteria
   */
  async countTasks(options: TaskQueryOptions): Promise<number> {
    const { status, queueName } = options;
    
    const query: any = {};
    if (status) {
      query.status = status;
    }
    if (queueName) {
      query.queueName = queueName;
    }
    
    return await this.taskModel.countDocuments(query).exec();
  }

  /**
   * Delete a task by its ID
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const result = await this.taskModel.deleteOne({ taskId }).exec();
    return result.deletedCount > 0;
  }

  /**
   * Mark a task as completed
   * @param taskId ID of the task to mark as completed
   * @param result Result data (optional)
   */
  async completeTask(taskId: string, result?: any): Promise<ITask> {
    const update: any = {
      status: TaskStatus.COMPLETED,
      completedAt: new Date(),
    };

    if (result) {
      update['metadata.result'] = result;
    }

    const task = await this.taskModel.findOneAndUpdate(
        { taskId },
        { $set: update },
        { new: true }
    ).exec();

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Handle removeOnComplete if defined in task metadata
    if (task.metadata?.removeOnComplete !== undefined) {
      await this.handleTaskCleanup(task, task.metadata.removeOnComplete);
    }

    return task;
  }

  /**
   * Mark a task as failed
   * @param taskId ID of the task to mark as failed
   * @param error Error message
   */
  async failTask(taskId: string, error: string): Promise<ITask> {
    const task = await this.taskModel.findOneAndUpdate(
        { taskId },
        {
          $set: {
            status: TaskStatus.FAILED,
            completedAt: new Date(),
            failureReason: error,
          },
        },
        { new: true }
    ).exec();

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Handle removeOnFail if defined in task metadata
    if (task.metadata?.removeOnFail !== undefined) {
      await this.handleTaskCleanup(task, task.metadata.removeOnFail);
    }

    return task;
  }

  /**
   * Handle task cleanup based on removal option
   * @param task Task to potentially clean up
   * @param removeOption Cleanup option (true, false, or seconds to wait)
   */
  private async handleTaskCleanup(task: ITask, removeOption: boolean | number): Promise<void> {
    if (removeOption === false) {
      return; // Don't remove
    }

    if (removeOption === true) {
      try {
        // Remove immediately
        const result = await this.taskModel.deleteOne({ taskId: task.taskId }).exec();
        if (result.deletedCount > 0) {
          this.logger.log(`Removed task ${task.taskId} immediately as configured`);
        } else {
          this.logger.warn(`Failed to remove task ${task.taskId}: document not found`);
        }
      } catch (error) {
        this.logger.error(`Error removing task ${task.taskId}: ${error.message}`);
      }
      return;
    }

    if (typeof removeOption === 'number' && removeOption > 0) {
      try {
        // Set the expireAt field for TTL index to handle automatic deletion
        const expireAt = new Date(Date.now() + (removeOption * 1000));

        const result = await this.taskModel.updateOne(
            { taskId: task.taskId },
            { $set: { expireAt } }
        ).exec();

        if (result.matchedCount > 0) {
          this.logger.log(`Set TTL expiration for task ${task.taskId} to expire in ${removeOption} seconds`);
        } else {
          this.logger.warn(`Failed to set TTL for task ${task.taskId}: document not found`);
        }
      } catch (error) {
        this.logger.error(`Error setting TTL for task ${task.taskId}: ${error.message}`);
      }
    }
  }
}

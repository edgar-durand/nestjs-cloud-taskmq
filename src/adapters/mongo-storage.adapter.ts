import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Schema } from 'mongoose';
import {
  IStateStorageAdapter,
  TaskQueryOptions,
} from '../interfaces/storage-adapter.interface';
import {
  ITask,
  IUniquenessKey,
  TaskStatus,
} from '../interfaces/task.interface';
import { IRateLimiterBucket } from '../interfaces/rate-limiter.interface';

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
      index: true,
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
    // Chain task fields
    chainId: { type: String, index: true },
    chainOrder: { type: Number, index: true },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    collection: 'cloud_taskmq_tasks',
  },
);

/**
 * MongoDB schema for rate limiter buckets
 */
export const RateLimiterBucketSchema = new Schema<IRateLimiterBucket>(
  {
    key: { type: String, required: true, unique: true, index: true },
    tokens: { type: Number, required: true },
    lastRefill: { type: Number, required: true },
    maxTokens: { type: Number, required: true },
    refillTimeMs: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: 'cloud_taskmq_rate_limiters',
  },
);

/**
 * MongoDB schema for uniquenessKey buckets
 */
export const UniquenessKeyBucketSchema = new Schema<IUniquenessKey>(
  {
    key: { type: String, required: true, unique: true, index: true },
  },
  {
    timestamps: true,
    collection: 'cloud_taskmq_uniqueness_keys',
  },
);

@Injectable()
export class MongoStorageAdapter implements IStateStorageAdapter {
  private readonly logger = new Logger(MongoStorageAdapter.name);
  private collectionName: string;
  private taskModel: Model<ITask>;
  private rateLimiterModel: Model<IRateLimiterBucket>;
  private uniquenessKeyModel: Model<IUniquenessKey>;

  constructor(
    @InjectConnection() private connection?: Connection,
    private customCollectionName?: string,
  ) {
    this.logger.debug(
      `MongoStorageAdapter constructor called with: connection=${!!this
        .connection}, collectionName=${this.customCollectionName}`,
    );
    this.initTaskModel();
    this.initRateLimiterModel();
    this.initUniquenessKeyModel();
  }

  async getUniquenessValue(key: string): Promise<boolean> {
    const keyDoc = await this.uniquenessKeyModel.findOne({ key }).lean().exec();
    return keyDoc && !!keyDoc.key;
  }

  async saveUniquenessKey(key: string): Promise<void> {
    await this.uniquenessKeyModel.create({ key });
  }

  async removeUniquenessKey(key: string): Promise<void> {
    await this.uniquenessKeyModel.deleteOne({ key });
  }

  private initTaskModel() {
    if (!this.connection) {
      this.logger.warn('Cannot initialize taskModel without connection');
      return;
    }

    const collName = this.customCollectionName || 'cloud_taskmq_tasks';
    this.logger.debug(
      `Using connection to create model with collection: ${collName}`,
    );

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
        collName,
      );
    }
  }

  private initRateLimiterModel() {
    if (!this.connection) {
      this.logger.warn('Cannot initialize rateLimiterModel without connection');
      return;
    }

    this.collectionName = this.customCollectionName || 'cloud_taskmq_tasks';

    const rateLimiterCollName = this.customCollectionName
      ? `${this.customCollectionName}_rate_limiters`
      : 'cloud_taskmq_rate_limiters';

    if (this.connection.models['CloudTaskMQRateLimiter']) {
      this.logger.debug(
        'Rate limiter model already exists on connection, reusing it',
      );
      this.rateLimiterModel = this.connection.models['CloudTaskMQRateLimiter'];
    } else {
      this.logger.debug('Creating new rate limiter model with schema');
      this.rateLimiterModel = this.connection.model<IRateLimiterBucket>(
        'CloudTaskMQRateLimiter',
        RateLimiterBucketSchema,
        rateLimiterCollName,
      );
    }
  }

  private initUniquenessKeyModel() {
    if (!this.connection) {
      this.logger.warn(
        'Cannot initialize uniquenessKeyModel without connection',
      );
      return;
    }

    this.collectionName = this.customCollectionName || 'cloud_taskmq_tasks';

    const uniquenessKeyCollName = this.customCollectionName
      ? `${this.customCollectionName}_uniqueness_keys`
      : 'cloud_taskmq_uniqueness_keys';

    if (this.connection.models['CloudTaskMQUniquenessKey']) {
      this.logger.debug(
        'UniquenessKey model already exists on connection, reusing it',
      );
      this.uniquenessKeyModel =
        this.connection.models['CloudTaskMQUniquenessKey'];
    } else {
      this.logger.debug('Creating new uniquenessKey model with schema');
      this.uniquenessKeyModel = this.connection.model<IUniquenessKey>(
        'CloudTaskMQUniquenessKey',
        UniquenessKeyBucketSchema,
        uniquenessKeyCollName,
      );
    }
  }

  /**
   * Initialize the MongoDB storage adapter
   */
  async initialize(): Promise<void> {
    this.logger.debug(
      `Initializing MongoStorageAdapter: taskModel=${!!this
        .taskModel}, collectionName=${this.collectionName}`,
    );

    if (!this.taskModel) {
      const error =
        'MongoStorageAdapter failed to initialize: No model or connection provided';
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      // Create indexes on the collection
      // Using the model's schema to ensure indexes
      const indexCreationPromises = [
        this.taskModel.collection.createIndex({ taskId: 1 }, { unique: true }),
        this.taskModel.collection.createIndex({ queueName: 1, status: 1 }),
        this.taskModel.collection.createIndex({ status: 1 }),
        this.taskModel.collection.createIndex({ createdAt: 1 }),
        this.taskModel.collection.createIndex({ 'metadata.originalTaskId': 1 }),
        this.taskModel.collection.createIndex({ 'metadata.retryCount': 1 }),
        this.taskModel.collection.createIndex(
          { lockedUntil: 1 },
          { sparse: true },
        ),
        // Chain-related indexes
        this.taskModel.collection.createIndex({ chainId: 1 }, { sparse: true }),
        this.taskModel.collection.createIndex(
          { chainId: 1, chainOrder: 1 },
          { sparse: true },
        ),
        this.taskModel.collection.createIndex(
          { chainId: 1, status: 1 },
          { sparse: true },
        ),
      ];

      // Verify the index exists
      const taskIndexes = await this.taskModel.collection.indexes();
      const uniquenessIndexes =
        await this.uniquenessKeyModel.collection.indexes();
      const taskTtlIndex = taskIndexes.find(
        (idx) => idx.key && idx.key.expireAt === 1,
      );
      const uniquenessTtlIndex = uniquenessIndexes.find(
        (idx) => idx.key && idx.key.createdAt === 1,
      );

      if (!taskTtlIndex) {
        // Create the TTL index explicitly
        const ttlIndexOptions = {
          expireAfterSeconds: 0,
          sparse: true,
          background: true,
          name: 'expireAt_ttl_index',
        };
        // Directly create TTL index on MongoDB collection
        await this.taskModel.collection.createIndex(
          { expireAt: 1 },
          ttlIndexOptions,
        );
        this.logger.log(
          'taskTtlIndex index created successfully in async configuration',
        );
      } else {
        this.logger.log('taskTtlIndex index already exists, skipping creation');
      }

      if (!uniquenessTtlIndex) {
        // Create the TTL index explicitly
        const ttlIndexOptions = {
          expireAfterSeconds: 60 * 60 * 24, // 24 hours
          sparse: true,
          background: true,
          name: 'createdAt_ttl_index',
        };
        // Directly create TTL index on MongoDB collection
        await this.uniquenessKeyModel.collection.createIndex(
          { createdAt: 1 },
          ttlIndexOptions,
        );
        this.logger.log(
          'uniquenessTtlIndex index created successfully in async configuration',
        );
      } else {
        this.logger.log(
          'uniquenessTtlIndex index already exists, skipping creation',
        );
      }

      await Promise.all(indexCreationPromises);
    } catch (err) {
      this.logger.error(`Error accessing MongoDB collection: ${err.message}`);
      throw err;
    }
  }

  /**
   * Create a new task record in MongoDB
   */
  async createTask(
    task: Omit<ITask, 'createdAt' | 'updatedAt'>,
  ): Promise<ITask> {
    const defaultTTL = 60 * 60 * 24 * 30; // 30 days
    const expireAt = new Date();
    expireAt.setSeconds(expireAt.getSeconds() + defaultTTL);
    task.expireAt = expireAt;
    return await this.taskModel
      .findOneAndUpdate(
        { taskId: task.taskId },
        { $set: task },
        { upsert: true, new: true },
      )
      .exec();
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

    return await this.taskModel
      .findOneAndUpdate({ taskId }, { $set: updateData }, { new: true })
      .exec();
  }

  /**
   * Acquire a lock on a task for processing
   */
  async acquireTaskLock(
    taskId: string,
    workerId: string,
    lockDurationMs: number,
  ): Promise<boolean> {
    // First check if the task exists and what its status is
    const existingTask = await this.taskModel.findOne({ taskId }).lean().exec();

    if (existingTask) {
      // If task is already completed, log and return false
      if (existingTask.status === TaskStatus.COMPLETED) {
        return false;
      }

      // If task is currently locked by another worker, log and return false
      if (
        existingTask.lockedUntil &&
        existingTask.lockedUntil > new Date() &&
        existingTask.workerId !== workerId
      ) {
        return false;
      }
    }

    const lockedUntil = new Date(Date.now() + lockDurationMs);

    const result = await this.taskModel
      .findOneAndUpdate(
        {
          taskId,
          // Only acquire lock on tasks that are not COMPLETED or FAILED
          status: { $nin: [TaskStatus.COMPLETED, TaskStatus.FAILED] },
          $or: [
            { workerId },
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
      )
      .exec();

    if (!result && existingTask && existingTask.status === TaskStatus.FAILED) {
    }

    return !!result;
  }

  /**
   * Release a lock on a task
   */
  async releaseTaskLock(taskId: string, workerId: string): Promise<boolean> {
    const result = await this.taskModel
      .findOneAndUpdate(
        { taskId, workerId },
        {
          $unset: {
            lockedUntil: 1,
            workerId: 1,
          },
        },
        { new: true },
      )
      .exec();

    return !!result;
  }

  /**
   * Find tasks matching the given criteria
   */
  async findTasks(options: Partial<TaskQueryOptions>): Promise<ITask[]> {
    const {
      skip = 0,
      limit = 100,
      sort = { createdAt: 'desc' },
      ...rest
    } = options;

    const query: any = { ...rest };

    return await this.taskModel
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .exec();
  }

  /**
   * Find tasks matching the given criteria and have not active version of the task
   * @param options Query options
   * @returns Array of matching tasks
   */
  async findTasksWithoutActiveVersion(
    options: TaskQueryOptions,
  ): Promise<ITask[]> {
    const {
      skip = 0,
      limit = 100,
      sort = { createdAt: 'desc' },
      ...rest
    } = options;

    const query: FilterQuery<ITask> = {
      ...rest,
    };

    const activeTaskIds = await this.taskModel
      .distinct('taskId', {
        ...query,
        status: TaskStatus.ACTIVE,
      })
      .lean()
      .exec();

    return this.taskModel
      .find({
        ...query,
        taskId: { $nin: activeTaskIds },
      })
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
      lockedUntil: undefined,
      workerId: undefined,
      completedAt: new Date(),
    };

    if (result) {
      update['metadata.result'] = result;
    }

    const task = await this.taskModel
      .findOneAndUpdate({ taskId }, { $set: update }, { new: true })
      .exec();

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Handle removeOnComplete if defined in task metadata
    if (task.metadata && 'removeOnComplete' in task.metadata) {
      try {
        await this.handleTaskCleanup(task, task.metadata.removeOnComplete);
      } catch (error) {
        this.logger.error(error, {
          message: `Failed to handle cleanup for task ${taskId}: ${error.message}`,
        });
        // Continue execution - don't fail the task completion due to cleanup errors
      }
    }

    return task;
  }

  /**
   * Mark a task as failed
   * @param taskId ID of the task to mark as failed
   * @param error Error message
   */
  async failTask(taskId: string, error: string): Promise<ITask | null> {
    const task = await this.taskModel
      .findOneAndUpdate(
        { taskId },
        {
          $set: {
            status: TaskStatus.FAILED,
            completedAt: new Date(),
            failureReason: error,
          },
          $inc: { retryCount: 1 },
        },
        { new: true },
      )
      .exec();

    if (!task) {
      this.logger.error(new Error(`Task ${taskId} not found`));
      return;
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
  async handleTaskCleanup(
    task: ITask,
    removeOption: boolean | number,
  ): Promise<void> {
    if (removeOption === false) {
      return;
    }

    // Handle boolean true - immediate removal
    if (removeOption === true) {
      await this.deleteTask(task.taskId);
      return;
    }

    // Handle number - TTL expiration
    if (typeof removeOption === 'number' && removeOption > 0) {
      const expireAt = new Date();
      expireAt.setSeconds(expireAt.getSeconds() + removeOption);

      await this.taskModel
        .updateOne(
          { taskId: task.taskId },
          {
            $set: {
              expireAt,
            },
          },
        )
        .exec();
      const originalTaskId = task.metadata?.originalTaskId;
      if (originalTaskId) {
        await this.taskModel
          .updateMany(
            { 'metadata.originalTaskId': originalTaskId },
            {
              $set: {
                expireAt,
              },
            },
          )
          .exec();
      }

      return;
    }
  }

  /**
   * Get a rate limiter bucket by its key
   * @param key The unique key for the rate limiter bucket
   */
  async getRateLimiterBucket(key: string): Promise<IRateLimiterBucket> {
    if (!this.rateLimiterModel) {
      this.logger.warn(
        'getRateLimiterBucket called but rateLimiterModel is not initialized',
      );
      return null;
    }

    try {
      return this.rateLimiterModel.findOne({ key }).lean().exec();
    } catch (error) {
      this.logger.error(error, {
        message: `Error getting rate limiter bucket: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Save a rate limiter bucket
   * @param bucket The rate limiter bucket to save
   */
  async saveRateLimiterBucket(
    bucket: IRateLimiterBucket,
  ): Promise<IRateLimiterBucket> {
    if (!this.rateLimiterModel) {
      this.logger.warn(
        'saveRateLimiterBucket called but rateLimiterModel is not initialized',
      );
      throw new Error('Rate limiter model not initialized');
    }

    try {
      return this.rateLimiterModel
        .findOneAndUpdate({ key: bucket.key }, bucket, {
          new: true,
          upsert: true,
        })
        .lean()
        .exec();
    } catch (error) {
      this.logger.error(error, {
        message: `Error saving rate limiter bucket: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Delete a rate limiter bucket
   * @param key The key of the bucket to delete
   */
  async deleteRateLimiterBucket(key: string): Promise<boolean> {
    if (!this.rateLimiterModel) {
      this.logger.warn(
        'deleteRateLimiterBucket called but rateLimiterModel is not initialized',
      );
      return false;
    }

    try {
      const result = await this.rateLimiterModel.deleteOne({ key }).exec();
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(error, {
        message: `Error deleting rate limiter bucket: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Check if a chain has an active task (task in progress)
   * @param chainId The unique chain identifier
   * @returns true if there's an active task in the chain, false otherwise
   */
  async hasActiveTaskInChain(chainId: string): Promise<boolean> {
    try {
      const activeTask = await this.taskModel
        .findOne({
          chainId,
          status: TaskStatus.ACTIVE,
        })
        .exec();

      return !!activeTask;
    } catch (error) {
      this.logger.error(error, {
        message: `Error checking for active tasks in chain ${chainId}: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Get the next task to execute in a chain (lowest chainOrder that is idle)
   * @param chainId The unique chain identifier
   * @returns The next task to execute or null if no idle tasks in chain
   */
  async getNextTaskInChain(chainId: string): Promise<ITask | null> {
    try {
      const nextTask = await this.taskModel
        .findOne({
          chainId,
          status: TaskStatus.IDLE,
        })
        .sort({ chainOrder: 1 })
        .exec();
      return nextTask;
    } catch (error) {
      this.logger.error(error, {
        message: `Error getting next task in chain ${chainId}: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Find tasks by chain ID ordered by chain order
   * @param chainId The unique chain identifier
   * @param status Optional status filter
   * @returns Array of tasks in the chain sorted by chainOrder
   */
  async findTasksByChainId(
    chainId: string,
    status?: TaskStatus,
  ): Promise<ITask[]> {
    try {
      const query: FilterQuery<ITask> = { chainId };

      if (status) {
        query.status = status;
      }

      const tasks = await this.taskModel
        .find(query)
        .sort({ chainOrder: 1 })
        .exec();

      return tasks;
    } catch (error) {
      this.logger.error(error, {
        message: `Error finding tasks in chain ${chainId}: ${error.message}`,
      });
      throw error;
    }
  }
}

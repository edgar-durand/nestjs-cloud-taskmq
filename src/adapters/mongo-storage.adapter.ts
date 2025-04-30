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
      const indexCreationResults = await Promise.all([
        this.taskModel.collection.createIndex({ taskId: 1 }, { unique: true }),
        this.taskModel.collection.createIndex({ queueName: 1, status: 1 }),
        this.taskModel.collection.createIndex({ status: 1 }),
        this.taskModel.collection.createIndex({ createdAt: 1 }),
        this.taskModel.collection.createIndex({ lockedUntil: 1 }, { sparse: true })
      ]);
      this.logger.log(`Created ${indexCreationResults.length} indexes on ${collName}`);

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
}

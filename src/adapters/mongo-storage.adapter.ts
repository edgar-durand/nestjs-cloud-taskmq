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

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel('CloudTaskMQTask') private taskModel: Model<ITask>,
  ) {
    this.collectionName = this.taskModel.collection.name;
  }

  /**
   * Initialize the MongoDB storage adapter
   */
  async initialize(): Promise<void> {
    this.logger.log(`Initialized MongoStorageAdapter with collection: ${this.collectionName}`);
    
    // Ensure indexes
    await this.connection.collection(this.collectionName).createIndexes([
      { key: { taskId: 1 }, unique: true },
      { key: { queueName: 1, status: 1 } },
      { key: { status: 1 } },
      { key: { createdAt: 1 } },
      { key: { lockedUntil: 1 }, sparse: true },
    ]);
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

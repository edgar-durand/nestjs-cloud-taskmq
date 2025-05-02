import { Injectable, Logger } from '@nestjs/common';
import { IStateStorageAdapter, TaskQueryOptions } from '../interfaces/storage-adapter.interface';
import { ITask, TaskStatus } from '../interfaces/task.interface';
import { Redis } from 'ioredis';
import {IRateLimiterBucket} from "../interfaces/rate-limiter.interface";

/**
 * Redis storage adapter for CloudTaskMQ
 */
@Injectable()
export class RedisStorageAdapter implements IStateStorageAdapter {
  private readonly logger = new Logger(RedisStorageAdapter.name);
  private readonly keyPrefix: string;
  private readonly client: Redis;

  constructor(options: {
    host?: string;
    port?: number;
    password?: string;
    url?: string;
    keyPrefix?: string;
    client?: Redis;
  }) {
    this.keyPrefix = options.keyPrefix || 'cloud-taskmq:';
    
    if (options.client) {
      this.client = options.client;
    } else if (options.url) {
      this.client = new Redis(options.url);
    } else {
      this.client = new Redis({
        host: options.host || 'localhost',
        port: options.port || 6379,
        password: options.password,
      });
    }
  }

  /**
   * Generate a Redis key for a task
   */
  private getTaskKey(taskId: string): string {
    return `${this.keyPrefix}task:${taskId}`;
  }

  /**
   * Generate a Redis key for a queue status set
   */
  private getQueueStatusKey(queueName: string, status: TaskStatus): string {
    return `${this.keyPrefix}queue:${queueName}:status:${status}`;
  }

  /**
   * Generate a Redis key for a status set (all queues)
   */
  private getStatusKey(status: TaskStatus): string {
    return `${this.keyPrefix}status:${status}`;
  }

  /**
   * Initialize the Redis storage adapter
   */
  async initialize(): Promise<void> {
    this.logger.log(`Initialized RedisStorageAdapter with prefix: ${this.keyPrefix}`);
    
    // Test connection
    await this.client.ping();
  }

  /**
   * Convert task data to/from Redis format
   */
  private serializeTask(task: ITask): Record<string, string> {
    const serialized: Record<string, string> = {};
    
    // Convert dates to ISO strings
    serialized.taskId = task.taskId;
    serialized.queueName = task.queueName;
    serialized.status = task.status;
    serialized.payload = JSON.stringify(task.payload);
    serialized.createdAt = task.createdAt.toISOString();
    serialized.updatedAt = task.updatedAt.toISOString();
    
    if (task.startedAt) serialized.startedAt = task.startedAt.toISOString();
    if (task.completedAt) serialized.completedAt = task.completedAt.toISOString();
    if (task.failureReason) serialized.failureReason = task.failureReason;
    if (task.retryCount !== undefined) serialized.retryCount = String(task.retryCount);
    if (task.lockedUntil) serialized.lockedUntil = task.lockedUntil.toISOString();
    if (task.workerId) serialized.workerId = task.workerId;
    if (task.metadata) serialized.metadata = JSON.stringify(task.metadata);
    
    return serialized;
  }

  /**
   * Deserialize task data from Redis format
   */
  private deserializeTask(data: Record<string, string>): ITask {
    const task: any = {
      taskId: data.taskId,
      queueName: data.queueName,
      status: data.status as TaskStatus,
      payload: JSON.parse(data.payload),
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
    
    if (data.startedAt) task.startedAt = new Date(data.startedAt);
    if (data.completedAt) task.completedAt = new Date(data.completedAt);
    if (data.failureReason) task.failureReason = data.failureReason;
    if (data.retryCount) task.retryCount = parseInt(data.retryCount, 10);
    if (data.lockedUntil) task.lockedUntil = new Date(data.lockedUntil);
    if (data.workerId) task.workerId = data.workerId;
    if (data.metadata) task.metadata = JSON.parse(data.metadata);
    
    return task as ITask;
  }

  /**
   * Create a new task record in Redis
   */
  async createTask(task: Omit<ITask, 'createdAt' | 'updatedAt'>): Promise<ITask> {
    const now = new Date();
    const fullTask: ITask = {
      ...task,
      createdAt: now,
      updatedAt: now,
    };
    
    const taskKey = this.getTaskKey(task.taskId);
    const serialized = this.serializeTask(fullTask);
    
    // Save task data and add to the appropriate index sets
    const multi = this.client.multi();
    multi.hmset(taskKey, serialized);
    
    // Add to status index
    const statusKey = this.getStatusKey(task.status);
    multi.sadd(statusKey, task.taskId);
    
    // Add to queue+status index
    const queueStatusKey = this.getQueueStatusKey(task.queueName, task.status);
    multi.sadd(queueStatusKey, task.taskId);
    
    await multi.exec();
    
    return fullTask;
  }

  /**
   * Get a task by its ID
   */
  async getTaskById(taskId: string): Promise<ITask | null> {
    const taskKey = this.getTaskKey(taskId);
    const data = await this.client.hgetall(taskKey);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    
    return this.deserializeTask(data);
  }

  /**
   * Update the status of a task
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    additionalData?: Partial<ITask>,
  ): Promise<ITask | null> {
    const taskKey = this.getTaskKey(taskId);
    const task = await this.getTaskById(taskId);
    
    if (!task) {
      return null;
    }
    
    // Add timestamps based on status
    const updateData: Partial<ITask> = {
      ...additionalData,
      status,
      updatedAt: new Date(),
    };
    
    if (status === TaskStatus.ACTIVE && !task.startedAt) {
      updateData.startedAt = new Date();
    } else if (status === TaskStatus.COMPLETED && !task.completedAt) {
      updateData.completedAt = new Date();
    }
    
    const updatedTask: ITask = {
      ...task,
      ...updateData,
    };
    
    const serialized = this.serializeTask(updatedTask);
    
    // Update task data and index sets
    const multi = this.client.multi();
    
    // Update the task data
    multi.hmset(taskKey, serialized);
    
    // Remove from old status index and add to new status index
    if (task.status !== status) {
      const oldStatusKey = this.getStatusKey(task.status);
      const newStatusKey = this.getStatusKey(status);
      multi.srem(oldStatusKey, taskId);
      multi.sadd(newStatusKey, taskId);
      
      // Update queue+status indexes
      const oldQueueStatusKey = this.getQueueStatusKey(task.queueName, task.status);
      const newQueueStatusKey = this.getQueueStatusKey(task.queueName, status);
      multi.srem(oldQueueStatusKey, taskId);
      multi.sadd(newQueueStatusKey, taskId);
    }
    
    await multi.exec();
    
    return updatedTask;
  }

  /**
   * Acquire a lock on a task for processing
   */
  async acquireTaskLock(
    taskId: string,
    workerId: string,
    lockDurationMs: number,
  ): Promise<boolean> {
    const taskKey = this.getTaskKey(taskId);
    const task = await this.getTaskById(taskId);

    if (!task) {
      this.logger.warn(`Failed to acquire lock for task ${taskId} - task does not exist`);
      return false;
    }

    // Check if task is already completed
    if (task.status === TaskStatus.COMPLETED) {
      this.logger.debug(`Skipping already completed task ${taskId}`);
      return false;
    }

    // Check if task is already locked
    if (
        task.lockedUntil &&
        task.lockedUntil > new Date() &&
        task.workerId !== workerId
    ) {
      this.logger.debug(`Task ${taskId} is locked until ${task.lockedUntil} by worker ${task.workerId}`);
      return false;
    }
    
    const lockedUntil = new Date(Date.now() + lockDurationMs);
    
    // Update task with lock information
    await this.updateTaskStatus(taskId, TaskStatus.ACTIVE, {
      lockedUntil,
      workerId,
    });
    
    return true;
  }

  /**
   * Release a lock on a task
   */
  async releaseTaskLock(taskId: string, workerId: string): Promise<boolean> {
    const task = await this.getTaskById(taskId);
    
    if (!task || task.workerId !== workerId) {
      return false;
    }
    
    // Update task to remove lock
    await this.updateTaskStatus(taskId, task.status, {
      lockedUntil: undefined,
      workerId: undefined,
    });
    
    return true;
  }

  /**
   * Find tasks matching the given criteria
   */
  async findTasks(options: TaskQueryOptions): Promise<ITask[]> {
    const { status, queueName, skip = 0, limit = 100 } = options;
    
    let taskIds: string[] = [];
    
    // Get task IDs based on query criteria
    if (status && queueName) {
      // Get tasks for specific queue and status
      const queueStatusKey = this.getQueueStatusKey(queueName, status);
      taskIds = await this.client.smembers(queueStatusKey);
    } else if (status) {
      // Get tasks for specific status across all queues
      const statusKey = this.getStatusKey(status);
      taskIds = await this.client.smembers(statusKey);
    } else if (queueName) {
      // For a specific queue, we need to union all status sets for that queue
      const statusKeys = Object.values(TaskStatus).map(s => 
        this.getQueueStatusKey(queueName, s)
      );
      taskIds = await this.client.sunion(...statusKeys);
    } else {
      // Without filters, we need to get all tasks - this is expensive
      // We'll use keys pattern, but in production you might want a different approach
      const taskKeyPattern = `${this.keyPrefix}task:*`;
      const keys = await this.client.keys(taskKeyPattern);
      taskIds = keys.map(key => key.replace(`${this.keyPrefix}task:`, ''));
    }
    
    // Apply pagination
    const paginatedIds = taskIds.slice(skip, skip + limit);
    
    // Fetch actual task data
    const tasks: ITask[] = [];
    for (const id of paginatedIds) {
      const task = await this.getTaskById(id);
      if (task) {
        tasks.push(task);
      }
    }
    
    // Sort tasks (Redis doesn't support sorting at query time)
    if (options.sort) {
      const [sortKey, sortOrder] = Object.entries(options.sort)[0];
      tasks.sort((a: any, b: any) => {
        const valueA = a[sortKey];
        const valueB = b[sortKey];
        
        if (valueA instanceof Date && valueB instanceof Date) {
          return sortOrder === 'asc' 
            ? valueA.getTime() - valueB.getTime() 
            : valueB.getTime() - valueA.getTime();
        }
        
        if (typeof valueA === 'string' && typeof valueB === 'string') {
          return sortOrder === 'asc'
            ? valueA.localeCompare(valueB)
            : valueB.localeCompare(valueA);
        }
        
        return sortOrder === 'asc' 
          ? (valueA > valueB ? 1 : -1)
          : (valueB > valueA ? 1 : -1);
      });
    }
    
    return tasks;
  }

  /**
   * Count tasks matching the given criteria
   */
  async countTasks(options: TaskQueryOptions): Promise<number> {
    const { status, queueName } = options;
    
    if (status && queueName) {
      // Count tasks for specific queue and status
      const queueStatusKey = this.getQueueStatusKey(queueName, status);
      return await this.client.scard(queueStatusKey);
    } else if (status) {
      // Count tasks for specific status across all queues
      const statusKey = this.getStatusKey(status);
      return await this.client.scard(statusKey);
    } else if (queueName) {
      // For a specific queue, we need to union all status sets for that queue
      const statusKeys = Object.values(TaskStatus).map(s => 
        this.getQueueStatusKey(queueName, s)
      );
      const union = await this.client.sunion(...statusKeys);
      return union.length;
    } else {
      // Without filters, count all tasks
      const taskKeyPattern = `${this.keyPrefix}task:*`;
      const keys = await this.client.keys(taskKeyPattern);
      return keys.length;
    }
  }

  /**
   * Delete a task by its ID
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getTaskById(taskId);
    
    if (!task) {
      return false;
    }
    
    const taskKey = this.getTaskKey(taskId);
    const statusKey = this.getStatusKey(task.status);
    const queueStatusKey = this.getQueueStatusKey(task.queueName, task.status);
    
    // Remove the task and its entries in index sets
    const multi = this.client.multi();
    multi.del(taskKey);
    multi.srem(statusKey, taskId);
    multi.srem(queueStatusKey, taskId);
    
    await multi.exec();
    
    return true;
  }

  async completeTask(taskId: string, result?: any): Promise<ITask> {
    const task = await this.getTaskById(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const update: any = {
      status: TaskStatus.COMPLETED,
      completedAt: new Date(),
    };

    if (result) {
      if (!task.metadata) {
        task.metadata = {};
      }
      task.metadata.result = result;
    }

    const updatedTask = await this.updateTaskStatus(
        taskId,
        TaskStatus.COMPLETED,
        update
    );

    if (!updatedTask) {
      throw new Error(`Failed to update task ${taskId}`);
    }

    // Handle removeOnComplete if defined in task metadata
    if (task.metadata?.removeOnComplete !== undefined) {
      await this.handleTaskCleanup(updatedTask, task.metadata.removeOnComplete);
    }

    return updatedTask;
  }

  async failTask(taskId: string, error: any): Promise<ITask> {
    const task = await this.getTaskById(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const updatedTask = await this.updateTaskStatus(
        taskId,
        TaskStatus.FAILED,
        {
          completedAt: new Date(),
          failureReason: error,
        }
    );

    if (!updatedTask) {
      throw new Error(`Failed to update task ${taskId}`);
    }

    // Handle removeOnFail if defined in task metadata
    if (task.metadata?.removeOnFail !== undefined) {
      await this.handleTaskCleanup(updatedTask, task.metadata.removeOnFail);
    }

    return updatedTask;
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
      // Remove immediately
      await this.deleteTask(task.taskId);
      this.logger.log(`Removed task ${task.taskId} immediately as configured`);
      return;
    }

    if (typeof removeOption === 'number' && removeOption > 0) {
      // Use Redis's built-in TTL mechanism to automatically expire the task
      const taskKey = this.getTaskKey(task.taskId);
      await this.client.expire(taskKey, removeOption);

      // Add a cleanup flag to the task metadata to signal that this task will be automatically removed
      await this.client.hset(taskKey, 'metadata', JSON.stringify({
        ...JSON.parse(await this.client.hget(taskKey, 'metadata') || '{}'),
        scheduled_for_cleanup: true,
        cleanup_after: removeOption
      }));

      this.logger.log(`Set Redis TTL for task ${task.taskId} to expire in ${removeOption} seconds`);
    }
  }

  /**
   * Generate a Redis key for a rate limiter bucket
   */
  private getRateLimiterKey(key: string): string {
    return `${this.keyPrefix}rate-limiter:${key}`;
  }

  /**
   * Get a rate limiter bucket by its key
   * @param key The unique key for the rate limiter bucket
   */
  async getRateLimiterBucket(key: string): Promise<IRateLimiterBucket | null> {
    try {
      const bucketKey = this.getRateLimiterKey(key);
      const data = await this.client.get(bucketKey);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as IRateLimiterBucket;
    } catch (error) {
      this.logger.error(`Error getting rate limiter bucket: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Save a rate limiter bucket
   * @param bucket The rate limiter bucket to save
   */
  async saveRateLimiterBucket(bucket: IRateLimiterBucket): Promise<IRateLimiterBucket> {
    try {
      const bucketKey = this.getRateLimiterKey(bucket.key);
      const now = new Date();

      const updatedBucket: IRateLimiterBucket = {
        ...bucket,
        updatedAt: now,
        createdAt: bucket.createdAt || now
      };

      await this.client.set(
          bucketKey,
          JSON.stringify(updatedBucket)
      );

      return updatedBucket;
    } catch (error) {
      this.logger.error(`Error saving rate limiter bucket: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Delete a rate limiter bucket
   * @param key The key of the bucket to delete
   */
  async deleteRateLimiterBucket(key: string): Promise<boolean> {
    try {
      const bucketKey = this.getRateLimiterKey(key);
      const result = await this.client.del(bucketKey);
      return result > 0;
    } catch (error) {
      this.logger.error(`Error deleting rate limiter bucket: ${error.message}`, error.stack);
      return false;
    }
  }
}

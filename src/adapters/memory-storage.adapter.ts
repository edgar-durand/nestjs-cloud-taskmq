import { Injectable, Logger } from '@nestjs/common';
import {
  IStateStorageAdapter,
  TaskQueryOptions,
} from '../interfaces/storage-adapter.interface';
import { ITask, TaskStatus } from '../interfaces/task.interface';
import { IRateLimiterBucket } from '../interfaces/rate-limiter.interface';

/**
 * In-memory storage adapter for CloudTaskMQ
 * This adapter stores tasks in memory and is suitable for development and testing
 */
@Injectable()
export class MemoryStorageAdapter implements IStateStorageAdapter {
  private tasks: Map<
    string,
    ITask & { lockedBy?: string; lockedUntil?: Date }
  > = new Map();
  private readonly logger = new Logger(MemoryStorageAdapter.name);
  private cleanupTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private rateLimiterBuckets: Map<string, IRateLimiterBucket> = new Map();
  private uniquenessKeyBuckets: Map<string, boolean> = new Map();

  async getUniquenessValue(key: string): Promise<boolean> {
    return this.uniquenessKeyBuckets.get(key);
  }

  async saveUniquenessKey(key: string): Promise<void> {
    this.uniquenessKeyBuckets.set(key, true);
  }

  async removeUniquenessKey(key: string): Promise<void> {
    this.uniquenessKeyBuckets.delete(key);
  }

  /**
   * Initialize the storage adapter
   */
  async initialize(): Promise<void> {
    // Nothing to do for memory adapter
  }

  /**
   * Create a new task in storage
   * @param task Task data to store
   * @returns The stored task with timestamps
   */
  async createTask(
    task: Omit<ITask, 'createdAt' | 'updatedAt'>,
  ): Promise<ITask> {
    const now = new Date();
    const newTask: ITask & { lockedBy?: string; lockedUntil?: Date } = {
      ...task,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.taskId, newTask);
    return newTask;
  }

  /**
   * Get a task by its ID
   * @param taskId ID of the task to retrieve
   * @returns The task or null if not found
   */
  async getTaskById(taskId: string): Promise<ITask | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    // Return a clean task object without the extra fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lockedBy, lockedUntil, ...cleanTask } = task;
    return cleanTask;
  }

  /**
   * Update the status of a task
   * @param taskId ID of the task to update
   * @param status New status
   * @param additionalData Additional data to update
   * @returns The updated task or null if not found
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    additionalData?: Partial<ITask>,
  ): Promise<ITask | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    const now = new Date();
    const updatedTask = {
      ...task,
      ...additionalData,
      status,
      updatedAt: now,
      taskId, // Ensure ID doesn't change
    };

    this.tasks.set(taskId, updatedTask);

    // Return a clean task object without the extra fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lockedBy, lockedUntil, ...cleanTask } = updatedTask;
    return cleanTask;
  }

  /**
   * Acquire a lock on a task for processing
   * @param taskId ID of the task to lock
   * @param workerId ID of the worker acquiring the lock
   * @param lockDurationMs How long to hold the lock in milliseconds
   * @returns True if lock was acquired, false otherwise
   */
  async acquireTaskLock(
    taskId: string,
    workerId: string,
    lockDurationMs: number,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.warn(
        `Failed to acquire lock for task ${taskId} - task does not exist`,
      );
      return false;
    }

    // Check if task is already completed
    if (task.status === TaskStatus.COMPLETED) {
      this.logger.debug(`Skipping already completed task ${taskId}`);
      return false;
    }

    // Check if task is already locked
    if (task.lockedBy && task.lockedUntil && task.lockedUntil > new Date()) {
      // Task is locked by another worker
      if (task.lockedBy !== workerId) {
        this.logger.debug(
          `Task ${taskId} is locked until ${task.lockedUntil} by worker ${task.lockedBy}`,
        );
        return false;
      }
      // Task is already locked by this worker, extend the lock
    }

    // Acquire or extend the lock
    const lockUntil = new Date(Date.now() + lockDurationMs);
    task.lockedBy = workerId;
    task.lockedUntil = lockUntil;
    task.updatedAt = new Date();
    task.status = TaskStatus.ACTIVE;
    if (!task.startedAt) {
      task.startedAt = new Date();
    }
    this.tasks.set(taskId, task);
    return true;
  }

  /**
   * Release a lock on a task
   * @param taskId ID of the task to release
   * @param workerId ID of the worker releasing the lock
   * @returns True if lock was released, false otherwise
   */
  async releaseTaskLock(taskId: string, workerId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.lockedBy !== workerId) {
      return false;
    }

    task.lockedBy = undefined;
    task.lockedUntil = undefined;
    task.updatedAt = new Date();

    this.tasks.set(taskId, task);
    return true;
  }

  /**
   * Find tasks matching the given criteria
   * @param options Query options
   * @returns Array of matching tasks
   */
  async findTasks(options: Partial<TaskQueryOptions>): Promise<ITask[]> {
    let results = Array.from(this.tasks.values());

    const { sort, skip = 0, limit = 10, ...rest } = options;

    // Filter
    results = results.filter((task) => {
      const query = { ...rest };
      for (const key of Object.keys(query)) {
        const value = query[key];
        if (task[key] !== value) {
          return false;
        }
      }
      return true;
    });

    // Sort results
    if (sort) {
      const [field, direction] = Object.entries(sort)[0];
      results = results.sort((a, b) => {
        const aValue = a[field];
        const bValue = b[field];
        const multiplier = direction === 'asc' ? 1 : -1;

        if (aValue instanceof Date && bValue instanceof Date) {
          return multiplier * (aValue.getTime() - bValue.getTime());
        }

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return multiplier * aValue.localeCompare(bValue);
        }

        return 0;
      });
    }

    // Apply pagination
    const paginatedResults = results.slice(skip, skip + limit);

    // Return clean task objects without the extra fields
    return paginatedResults.map((task) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { lockedBy, lockedUntil, ...cleanTask } = task;
      return cleanTask;
    });
  }

  /**
   * Find tasks matching the given criteria and have not active version of the task
   * @param options Query options
   * @returns Array of matching tasks
   */
  async findTasksWithoutActiveVersion(
    options: TaskQueryOptions,
  ): Promise<ITask[]> {
    const results = await this.findTasks(options);
    return results.filter((task) => task.status !== TaskStatus.ACTIVE);
  }

  /**
   * Count tasks matching the given criteria
   * @param options Query options
   * @returns Count of matching tasks
   */
  async countTasks(options: TaskQueryOptions): Promise<number> {
    let count = 0;

    for (const task of this.tasks.values()) {
      if (
        (!options.queueName || task.queueName === options.queueName) &&
        (!options.status || task.status === options.status)
      ) {
        count++;
      }
    }

    return count;
  }

  /**
   * Delete a task by its ID
   * @param taskId ID of the task to delete
   * @returns True if the task was deleted, false if it wasn't found
   */
  async deleteTask(taskId: string): Promise<boolean> {
    // Cancel any cleanup timeouts for this task
    if (this.cleanupTimeouts.has(taskId)) {
      clearTimeout(this.cleanupTimeouts.get(taskId));
      this.cleanupTimeouts.delete(taskId);
    }

    return this.tasks.delete(taskId);
  }

  /**
   * Mark a task as completed
   * @param taskId ID of the task to mark as completed
   * @param result Result data (optional)
   */
  async completeTask(taskId: string, result?: any): Promise<ITask> {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const now = new Date();
    const updatedTask = {
      ...task,
      status: TaskStatus.COMPLETED,
      completedAt: now,
      updatedAt: now,
    };

    // Add result to metadata if provided
    if (result) {
      if (!updatedTask.metadata) {
        updatedTask.metadata = {};
      }
      updatedTask.metadata.result = result;
    }

    this.tasks.set(taskId, updatedTask);

    // Handle removal if configured
    if (updatedTask.metadata?.removeOnComplete !== undefined) {
      await this.handleTaskCleanup(
        updatedTask,
        updatedTask.metadata.removeOnComplete,
      );
    }

    // Return a clean task object without the extra fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lockedBy, lockedUntil, ...cleanTask } = updatedTask;
    return cleanTask;
  }

  /**
   * Mark a task as failed
   * @param taskId ID of the task to mark as failed
   * @param error Error message
   */
  async failTask(taskId: string, error: string): Promise<ITask> {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const now = new Date();
    const updatedTask = {
      ...task,
      status: TaskStatus.FAILED,
      failureReason: error,
      completedAt: now,
      updatedAt: now,
    };

    this.tasks.set(taskId, updatedTask);

    // Handle removal if configured
    if (updatedTask.metadata?.removeOnFail !== undefined) {
      await this.handleTaskCleanup(
        updatedTask,
        updatedTask.metadata.removeOnFail,
      );
    }

    // Return a clean task object without the extra fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lockedBy, lockedUntil, ...cleanTask } = updatedTask;
    return cleanTask;
  }

  /**
   * Handle task cleanup based on removal option
   * @param task Task to potentially clean up
   * @param removeOption Cleanup option (true, false, or seconds to wait)
   */
  private async handleTaskCleanup(
    task: ITask,
    removeOption: boolean | number,
  ): Promise<void> {
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
      // For memory adapter, we'll use setTimeout but track timeouts to be able to clean them up
      // Cancel any existing timeout for this task
      if (this.cleanupTimeouts.has(task.taskId)) {
        clearTimeout(this.cleanupTimeouts.get(task.taskId));
      }

      // Set a new timeout
      const deleteAfterMs = removeOption * 1000;
      const timeout = setTimeout(async () => {
        try {
          await this.deleteTask(task.taskId);
          this.logger.log(
            `Removed task ${task.taskId} after ${removeOption} seconds as configured`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to clean up task ${task.taskId}: ${error.message}`,
          );
        } finally {
          // Clean up the timeout reference
          this.cleanupTimeouts.delete(task.taskId);
        }
      }, deleteAfterMs);

      // Store the timeout reference
      this.cleanupTimeouts.set(task.taskId, timeout);
      this.logger.log(
        `Scheduled removal of task ${task.taskId} in ${removeOption} seconds`,
      );
    }
  }

  /**
   * Get a rate limiter bucket by its key
   * @param key The unique key for the rate limiter bucket
   */
  async getRateLimiterBucket(key: string): Promise<IRateLimiterBucket | null> {
    return this.rateLimiterBuckets.get(key) || null;
  }

  /**
   * Save a rate limiter bucket
   * @param bucket The rate limiter bucket to save
   */
  async saveRateLimiterBucket(
    bucket: IRateLimiterBucket,
  ): Promise<IRateLimiterBucket> {
    const now = new Date();
    const updatedBucket: IRateLimiterBucket = {
      ...bucket,
      updatedAt: now,
      createdAt: bucket.createdAt || now,
    };

    this.rateLimiterBuckets.set(bucket.key, updatedBucket);
    return updatedBucket;
  }

  /**
   * Delete a rate limiter bucket
   * @param key The key of the bucket to delete
   */
  async deleteRateLimiterBucket(key: string): Promise<boolean> {
    return this.rateLimiterBuckets.delete(key);
  }

  /**
   * Check if a chain has an active task (task in progress)
   * @param chainId The unique chain identifier
   * @returns true if there's an active task in the chain, false otherwise
   */
  async hasActiveTaskInChain(chainId: string): Promise<boolean> {
    for (const [, task] of this.tasks) {
      if (task.chainId === chainId && task.status === TaskStatus.ACTIVE) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the next task to execute in a chain (lowest chainOrder that is idle)
   * @param chainId The unique chain identifier
   * @returns The next task to execute or null if no idle tasks in chain
   */
  async getNextTaskInChain(chainId: string): Promise<ITask | null> {
    const idleTasks: ITask[] = [];

    for (const [, task] of this.tasks) {
      if (task.chainId === chainId && task.status === TaskStatus.IDLE) {
        // Remove extra fields for clean task object
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lockedBy, lockedUntil, ...cleanTask } = task as any;
        idleTasks.push(cleanTask);
      }
    }

    if (idleTasks.length === 0) {
      return null;
    }

    // Sort by chainOrder and return the first one
    idleTasks.sort((a, b) => (a.chainOrder || 0) - (b.chainOrder || 0));
    return idleTasks[0];
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
    const chainTasks: ITask[] = [];

    for (const [, task] of this.tasks) {
      if (task.chainId === chainId) {
        if (!status || task.status === status) {
          // Remove extra fields for clean task object
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { lockedBy, lockedUntil, ...cleanTask } = task as any;
          chainTasks.push(cleanTask);
        }
      }
    }

    // Sort by chainOrder
    chainTasks.sort((a, b) => (a.chainOrder || 0) - (b.chainOrder || 0));
    return chainTasks;
  }
}

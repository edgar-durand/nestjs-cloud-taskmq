import { ITask, TaskStatus } from './task.interface';
import { IRateLimiterBucket } from './rate-limiter.interface';

/**
 * Options for querying tasks
 */
export interface TaskQueryOptions extends ITask {
  /**
   * Skip N records
   */
  skip?: number;

  /**
   * Limit to N records
   */
  limit?: number;

  /**
   * Sort options
   */
  sort?: {
    [key: string]: 'asc' | 'desc';
  };
}

/**
 * Interface for storage adapters that persist task state
 */
export interface IStateStorageAdapter {
  /**
   * Initialize the storage adapter
   */
  initialize(): Promise<void>;

  /**
   * Create a new task record in the storage
   * @param task Task to create
   */
  createTask(task: Omit<ITask, 'createdAt' | 'updatedAt'>): Promise<ITask>;

  /**
   * Get a task by its ID
   * @param taskId ID of the task to retrieve
   */
  getTaskById(taskId: string): Promise<ITask | null>;

  /**
   * Update the status of a task
   * @param taskId ID of the task to update
   * @param status New status
   * @param additionalData Additional data to update
   */
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    additionalData?: Partial<ITask>,
  ): Promise<ITask | null>;

  /**
   * Acquire a lock on a task for processing
   * @param taskId ID of the task to lock
   * @param workerId ID of the worker acquiring the lock
   * @param lockDurationMs How long to hold the lock in milliseconds
   */
  acquireTaskLock(
    taskId: string,
    workerId: string,
    lockDurationMs: number,
  ): Promise<boolean>;

  /**
   * Release a lock on a task
   * @param taskId ID of the task to release
   * @param workerId ID of the worker releasing the lock
   */
  releaseTaskLock(taskId: string, workerId: string): Promise<boolean>;

  /**
   * Find tasks matching the given criteria
   * @param options Query options
   */
  findTasks(options: Partial<TaskQueryOptions>): Promise<ITask[]>;

  /**
   * Finds and returns all tasks that do not have an active version based on the given query options.
   *
   * @param {Partial<TaskQueryOptions>} options - A partial object specifying the query options to filter the tasks.
   * @return {Promise<ITask[]>} A promise that resolves to an array of tasks without an active version.
   */
  findTasksWithoutActiveVersion(
    options: Partial<TaskQueryOptions>,
  ): Promise<ITask[]>;

  /**
   * Count tasks matching the given criteria
   * @param options Query options
   */
  countTasks(options: Partial<TaskQueryOptions>): Promise<number>;

  /**
   * Delete a task by its ID
   * @param taskId ID of the task to delete
   */
  deleteTask(taskId: string): Promise<boolean>;

  completeTask(taskId: string, result?: any): Promise<ITask>;
  failTask(taskId: string, error: any): Promise<ITask>;

  // Rate limiter methods
  /**
   * Get a rate limiter bucket by its key
   * @param key The unique key for the rate limiter bucket
   */
  getRateLimiterBucket(key: string): Promise<IRateLimiterBucket | null>;

  /**
   * Save a rate limiter bucket
   * @param bucket The rate limiter bucket to save
   */
  saveRateLimiterBucket(
    bucket: IRateLimiterBucket,
  ): Promise<IRateLimiterBucket>;

  /**
   * Delete a rate limiter bucket
   * @param key The key of the bucket to delete
   */
  deleteRateLimiterBucket(key: string): Promise<boolean>;

  getUniquenessValue(key: string): Promise<boolean>;
  saveUniquenessKey(key: string): Promise<void>;
  removeUniquenessKey(key: string): Promise<void>;
}

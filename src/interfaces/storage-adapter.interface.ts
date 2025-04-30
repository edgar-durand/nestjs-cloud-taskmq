import { ITask, TaskStatus } from './task.interface';

/**
 * Options for querying tasks
 */
export interface TaskQueryOptions {
  /**
   * Filter by task status
   */
  status?: TaskStatus;
  
  /**
   * Filter by queue name
   */
  queueName?: string;
  
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
    additionalData?: Partial<ITask>
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
    lockDurationMs: number
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
  findTasks(options: TaskQueryOptions): Promise<ITask[]>;
  
  /**
   * Count tasks matching the given criteria
   * @param options Query options
   */
  countTasks(options: TaskQueryOptions): Promise<number>;
  
  /**
   * Delete a task by its ID
   * @param taskId ID of the task to delete
   */
  deleteTask(taskId: string): Promise<boolean>;

  completeTask(taskId: string, result?: any): Promise<ITask>;
  failTask(taskId: string, error: any): Promise<ITask>;
}

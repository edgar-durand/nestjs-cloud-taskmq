/**
 * Represents a retry history entry
 */
export interface RetryHistoryEntry {
  /**
   * When the retry happened
   */
  timestamp: Date;

  /**
   * How long the task was delayed before retrying
   */
  waitTimeMs: number;

  /**
   * Reason for the retry
   */
  reason: string;
}

/**
 * Metadata for tasks with retry information
 */
export interface TaskMetadata {
  /**
   * ID of the original task (before any retries)
   */
  originalTaskId?: string;

  /**
   * Number of times this task has been retried
   */
  retryCount?: number;

  /**
   * History of retries for this task
   */
  retryHistory?: RetryHistoryEntry[];

  /**
   * Any other metadata as key-value pairs
   */
  [key: string]: any;
}

/**
 * Represents the status of a task in the queue system
 */
export enum TaskStatus {
  IDLE = 'idle',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Represents a task in the queue system
 */
export interface ITask {
  /**
   * Unique ID of the task (from Cloud Tasks)
   */
  taskId: string;
  
  /**
   * Name of the queue this task belongs to
   */
  queueName: string;
  
  /**
   * Current status of the task
   */
  status: TaskStatus;
  
  /**
   * Payload data for the task (will be sent to the handler)
   */
  payload: any;
  
  /**
   * When the task was created
   */
  createdAt: Date;
  
  /**
   * When the task was last updated
   */
  updatedAt: Date;
  
  /**
   * When the task started processing
   */
  startedAt?: Date;
  
  /**
   * When the task completed processing
   */
  completedAt?: Date;
  
  /**
   * If the task failed, the reason for failure
   */
  failureReason?: string;
  
  /**
   * Number of times this task has been attempted
   */
  retryCount?: number;
  
  /**
   * Until when this task is locked by a worker
   */
  lockedUntil?: Date;
  
  /**
   * ID of the worker processing this task (if applicable)
   */
  workerId?: string;
  
  /**
   * Any additional metadata for the task
   */
  metadata?: TaskMetadata;

  /**
   * When the document should be automatically removed by MongoDB TTL index
   * This is used internally by storage adapters for automatic cleanup
   */
  expireAt?: Date;
}

/**
 * Options for adding a task to a queue
 */
export interface AddTaskOptions {
  /**
   * Custom task ID to use instead of generating a UUID
   * This can be useful for idempotent task creation or when you need to integrate with external systems
   */
  taskId?: string;

  /**
   * When to schedule the task. If not provided, the task is scheduled immediately.
   */
  scheduleTime?: Date;
  
  /**
   * Additional metadata to store with the task
   */
  metadata?: Record<string, any>;

  /**
   * Whether to remove the task from storage once it's completed.
   * If set to true, the task will be removed immediately on completion.
   * If set to a number, the task will be removed after that many seconds.
   * If set to false or not provided, the task will remain in storage.
   */
  removeOnComplete?: boolean | number;

  /**
   * Whether to remove the task from storage if it fails.
   * If set to true, the task will be removed immediately after failing.
   * If set to a number, the task will be removed after that many seconds.
   * If set to false or not provided, the task will remain in storage.
   */
  removeOnFail?: boolean | number;

  /**
   * Custom rate limiter key for this task
   * This can be used to group tasks for rate limiting purposes
   * this key must exist in the rate limiter configuration for the queue it's added to
   */
  rateLimiterKey?: string;

  /**
   * Maximum number of retries for rate-limited tasks
   * After this many retries, the task will be marked as failed
   * Default: 5
   */
  maxRetry?: number;
}

/**
 * Result of adding a task to a queue
 */
export interface AddTaskResult {
  /**
   * ID of the created task
   */
  taskId: string;
  
  /**
   * Name of the queue the task was added to
   */
  queueName: string;
  
  /**
   * When the task was created
   */
  createdAt: Date;
}

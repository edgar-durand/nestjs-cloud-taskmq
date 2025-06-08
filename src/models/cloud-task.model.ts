import { TaskStatus } from '../interfaces/task.interface';

/**
 * Represents a Cloud Task with methods for interacting with it
 */
export class CloudTask<T = any> {
  /**
   * Unique identifier for the task
   */
  readonly taskId: string;

  /**
   * Name of the queue this task belongs to
   */
  readonly queueName: string;

  /**
   * Current status of the task
   */
  status: TaskStatus;

  /**
   * Payload data (typed)
   */
  readonly payload: T;

  /**
   * When the task was created
   */
  readonly createdAt: Date;

  /**
   * When the task was last updated
   */
  readonly updatedAt: Date;

  /**
   * When the task started processing
   */
  readonly startedAt?: Date;

  /**
   * When the task completed processing
   */
  readonly completedAt?: Date;

  /**
   * If task failed, why it failed
   */
  readonly failureReason?: string;

  /**
   * Number of retries attempted
   */
  readonly retryCount?: number;

  /**
   * Additional metadata for the task
   */
  readonly metadata?: Record<string, any>;

  /**
   * Reference to a function that can be called to report progress
   * This is populated by the consumer when processing the task
   */
  private _reportProgress?: (progress: number) => Promise<void>;

  constructor(data: any) {
    this.taskId = data.taskId;
    this.queueName = data.queueName;
    this.status = data.status;
    this.payload = data.payload;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.startedAt = data.startedAt;
    this.completedAt = data.completedAt;
    this.failureReason = data.failureReason;
    this.retryCount = data.retryCount;
    this.metadata = data.metadata;
  }

  /**
   * Sets the progress reporter function
   * @internal Used by the library
   */
  setProgressReporter(reporter: (progress: number) => Promise<void>) {
    this._reportProgress = reporter;
  }

  /**
   * Reports the current progress of the task (0-100)
   * @param progress Progress percentage (0-100)
   */
  async reportProgress(progress: number): Promise<void> {
    if (!this._reportProgress) {
      throw new Error('Progress reporting is not available for this task');
    }

    // Validate progress is between 0-100
    const validProgress = Math.max(0, Math.min(100, progress));

    await this._reportProgress(validProgress);
  }
}

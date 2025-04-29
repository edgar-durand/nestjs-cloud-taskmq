import { Injectable } from '@nestjs/common';
import { IStateStorageAdapter, TaskQueryOptions } from '../interfaces/storage-adapter.interface';
import { ITask, TaskStatus } from '../interfaces/task.interface';

/**
 * In-memory storage adapter for CloudTaskMQ
 * This adapter stores tasks in memory and is suitable for development and testing
 */
@Injectable()
export class MemoryStorageAdapter implements IStateStorageAdapter {
  private tasks: Map<string, ITask & { lockedBy?: string; lockedUntil?: Date }> = new Map();
  
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
  async createTask(task: Omit<ITask, 'createdAt' | 'updatedAt'>): Promise<ITask> {
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
    additionalData?: Partial<ITask>
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
    lockDurationMs: number
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    
    // Check if task is already locked
    if (task.lockedBy && task.lockedUntil && task.lockedUntil > new Date()) {
      // Task is locked by another worker
      if (task.lockedBy !== workerId) {
        return false;
      }
      // Task is already locked by this worker, extend the lock
    }
    
    // Acquire or extend the lock
    const lockUntil = new Date(Date.now() + lockDurationMs);
    task.lockedBy = workerId;
    task.lockedUntil = lockUntil;
    task.updatedAt = new Date();
    
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
  async findTasks(options: TaskQueryOptions): Promise<ITask[]> {
    let results = Array.from(this.tasks.values());
    
    // Filter by queue name
    if (options.queueName) {
      results = results.filter(task => task.queueName === options.queueName);
    }
    
    // Filter by status
    if (options.status) {
      results = results.filter(task => task.status === options.status);
    }
    
    // Sort results
    if (options.sort) {
      const [field, direction] = Object.entries(options.sort)[0];
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
    const skip = options.skip || 0;
    const limit = options.limit || 10;
    const paginatedResults = results.slice(skip, skip + limit);
    
    // Return clean task objects without the extra fields
    return paginatedResults.map(task => {
      const { lockedBy, lockedUntil, ...cleanTask } = task;
      return cleanTask;
    });
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
    return this.tasks.delete(taskId);
  }
}

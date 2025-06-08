/**
 * Example of how to use the CloudTaskMQ producer to add tasks to queues
 */
import { Injectable } from '@nestjs/common';
import { ProducerService, TaskStatus } from '../src';

// Example data structure for your email tasks
interface EmailData {
  to: string;
  subject: string;
  body: string;
  attachments?: string[];
}

@Injectable()
export class EmailService {
  constructor(private readonly producerService: ProducerService) {}

  /**
   * Queue an email to be sent asynchronously
   */
  async queueEmail(data: EmailData): Promise<string> {
    const result = await this.producerService.addTask(
      'email-queue', // Queue name as registered in the module
      data, // The payload data for the task
      {
        // Optional: Schedule for a specific time
        // scheduleTime: new Date(Date.now() + 60000), // 1 minute from now

        // Optional: Additional metadata
        metadata: {
          priority: 'high',
          category: 'transactional',
        },
      },
    );

    return result.taskId;
  }

  /**
   * Get information about a specific email task
   */
  async getEmailStatus(taskId: string): Promise<any> {
    const task = await this.producerService.getTask(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return {
      id: task.taskId,
      status: task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      error: task.failureReason,
    };
  }

  /**
   * Retrieve tasks that have failed
   */
  async getFailedEmails(limit = 10): Promise<any[]> {
    return this.producerService.findTasks(
      'email-queue', // Queue name
      TaskStatus.FAILED, // Status filter
      limit, // Limit
      0, // Skip (for pagination)
    );
  }

  /**
   * Get statistics about the email queue
   */
  async getEmailQueueStats(): Promise<Record<string, number>> {
    return this.producerService.getQueueStatusCounts('email-queue');
  }
}

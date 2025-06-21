/**
 * Example of how to create a processor for handling tasks from a specific queue
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  CloudTask,
  OnTaskActive,
  OnTaskCompleted,
  OnTaskFailed,
  Process,
  Processor,
} from '../src';

// Type definition for the task payload (same as used by the producer)
interface EmailData {
  to: string;
  subject: string;
  body: string;
  attachments?: string[];
}

// Create an injectable service that's also a processor for a specific queue
@Injectable()
@Processor('email-queue')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  // In a real application, you'd inject your email sending service
  constructor(private readonly actualEmailService: any) {}

  /**
   * This method will be called when a task from the email-queue is received
   */
  @Process()
  async handleEmailTask(task: CloudTask<EmailData>): Promise<any> {
    this.logger.log(
      `Processing email task ${task.taskId} to: ${task.payload.to}`,
    );

    // Report progress at 10%
    await task.reportProgress(10);

    // Extract data from the task payload
    const { to, subject } = task.payload;

    // Validate email data
    if (!to || !subject) {
      throw new Error('Missing required email fields');
    }

    // Update progress to 30%
    await task.reportProgress(30);

    // In a real app, you would actually send the email here
    // await this.actualEmailService.sendEmail(to, subject, body, attachments);

    // Simulate email sending with a delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Final progress update
    await task.reportProgress(100);

    // Return data that will be passed to the onCompleted handler
    return {
      success: true,
      messageId: `msg_${Math.random().toString(36).substring(2, 15)}`,
      sentAt: new Date(),
    };
  }

  /**
   * Called when the task starts processing
   */
  @OnTaskActive()
  onActive(task: CloudTask<EmailData>): void {
    this.logger.log(`Starting to process email to: ${task.payload.to}`);

    // You could update a dashboard or notify someone that processing has started
  }

  /**
   * Called when the task completes successfully
   */
  @OnTaskCompleted()
  onCompleted(task: CloudTask<EmailData>, result: any): void {
    this.logger.log(
      `Successfully sent email to ${task.payload.to}, message ID: ${result.messageId}`,
    );

    // You could update a database record or notify someone that the email was sent
  }

  /**
   * Called when the task fails with an error
   */
  @OnTaskFailed()
  onFailed(task: CloudTask<EmailData>, error: Error): void {
    this.logger.error(
      `Failed to send email to ${task.payload.to}: ${error.message}`,
      error.stack,
    );

    // You could log the failure, notify administrators, or implement fallback logic
  }
}

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata keys for various queue lifecycle events
 */
export const ON_QUEUE_ACTIVE_KEY = 'cloud_taskmq:on_queue_active';
export const ON_QUEUE_COMPLETED_KEY = 'cloud_taskmq:on_queue_completed';
export const ON_QUEUE_FAILED_KEY = 'cloud_taskmq:on_queue_failed';
export const ON_QUEUE_PROGRESS_KEY = 'cloud_taskmq:on_queue_progress';

/**
 * Marks a method to be called when a task becomes active (starts processing).
 *
 * @example
 * ```typescript
 * @Processor('email-queue')
 * export class EmailProcessor {
 *   @Process()
 *   async handleEmailTask(job: CloudTask<EmailData>) {
 *     // Process the email task
 *     return { success: true };
 *   }
 *
 *   @OnQueueActive()
 *   onActive(task: CloudTask) {
 *     console.log(`Processing job ${task.id} from ${task.queueName}`);
 *   }
 * }
 * ```
 */
export function OnQueueActive() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_QUEUE_ACTIVE_KEY, {
      methodName: propertyKey,
    })(descriptor.value);
    return descriptor;
  };
}

/**
 * Marks a method to be called when a task completes successfully.
 *
 * @example
 * ```typescript
 * @Processor('email-queue')
 * export class EmailProcessor {
 *   @Process()
 *   async handleEmailTask(job: CloudTask<EmailData>) {
 *     // Process the email task
 *     return { success: true };
 *   }
 *
 *   @OnQueueCompleted()
 *   onCompleted(task: CloudTask, result: any) {
 *     console.log(`Job ${task.id} completed with result:`, result);
 *   }
 * }
 * ```
 */
export function OnQueueCompleted() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_QUEUE_COMPLETED_KEY, {
      methodName: propertyKey,
    })(descriptor.value);
    return descriptor;
  };
}

/**
 * Marks a method to be called when a task fails.
 *
 * @example
 * ```typescript
 * @Processor('email-queue')
 * export class EmailProcessor {
 *   @Process()
 *   async handleEmailTask(job: CloudTask<EmailData>) {
 *     // Process the email task
 *     throw new Error('Email sending failed');
 *   }
 *
 *   @OnQueueFailed()
 *   onFailed(task: CloudTask, error: Error) {
 *     console.error(`Job ${task.id} failed with error:`, error);
 *   }
 * }
 * ```
 */
export function OnQueueFailed() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_QUEUE_FAILED_KEY, {
      methodName: propertyKey,
    })(descriptor.value);
    return descriptor;
  };
}

/**
 * Marks a method to be called when a task reports progress.
 *
 * @example
 * ```typescript
 * @Processor('email-queue')
 * export class EmailProcessor {
 *   @Process()
 *   async handleEmailTask(job: CloudTask<EmailData>) {
 *     job.reportProgress(50);
 *     // Continue processing...
 *     return { success: true };
 *   }
 *
 *   @OnQueueProgress()
 *   onProgress(task: CloudTask, progress: number) {
 *     console.log(`Job ${task.id} is ${progress}% complete`);
 *   }
 * }
 * ```
 */
export function OnQueueProgress() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_QUEUE_PROGRESS_KEY, {
      methodName: propertyKey,
    })(descriptor.value);
    return descriptor;
  };
}

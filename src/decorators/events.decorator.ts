import { SetMetadata } from '@nestjs/common';

/**
 * Metadata keys for various queue lifecycle events
 */
export const ON_TASK_ACTIVE_KEY = 'cloud_taskmq:on_task_active';
export const ON_TASK_COMPLETED_KEY = 'cloud_taskmq:on_task_completed';
export const ON_TASK_FAILED_KEY = 'cloud_taskmq:on_task_failed';
export const ON_TASK_PROGRESS_KEY = 'cloud_taskmq:on_task_progress';

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
 *   @OnTaskActive()
 *   onActive(task: CloudTask) {
 *     console.log(`Processing job ${task.id} from ${task.queueName}`);
 *   }
 * }
 * ```
 */
export function OnTaskActive() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_TASK_ACTIVE_KEY, {
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
 *   @OnTaskCompleted()
 *   onCompleted(task: CloudTask, result: any) {
 *     console.log(`Job ${task.id} completed with result:`, result);
 *   }
 * }
 * ```
 */
export function OnTaskCompleted() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_TASK_COMPLETED_KEY, {
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
 *   @OnTaskFailed()
 *   onFailed(task: CloudTask, error: Error) {
 *     console.error(`Job ${task.id} failed with error:`, error);
 *   }
 * }
 * ```
 */
export function OnTaskFailed() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_TASK_FAILED_KEY, {
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
 *   @OnTaskProgress()
 *   onProgress(task: CloudTask, progress: number) {
 *     console.log(`Job ${task.id} is ${progress}% complete`);
 *   }
 * }
 * ```
 */
export function OnTaskProgress() {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(ON_TASK_PROGRESS_KEY, {
      methodName: propertyKey,
    })(descriptor.value);
    return descriptor;
  };
}

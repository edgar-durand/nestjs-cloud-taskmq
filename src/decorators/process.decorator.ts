import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for process method decorators
 */
export const PROCESS_METHOD_KEY = 'cloud_taskmq:process_method';

/**
 * Process method options
 */
export interface ProcessOptions {
  /**
   * Custom name for the processor (if different than the method name)
   */
  name?: string;

  /**
   * Concurrency limit for this specific handler
   */
  concurrency?: number;
}

/**
 * Marks a method as a task handler within a processor class.
 * Methods decorated with @Process() will be invoked when a task from the
 * queue registered by the class-level @Processor() decorator is received.
 *
 * @param options Additional process handler options
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
 * }
 * ```
 */
export function Process(options: ProcessOptions = {}) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(PROCESS_METHOD_KEY, {
      methodName: propertyKey,
      ...options,
    })(descriptor.value);
    return descriptor;
  };
}

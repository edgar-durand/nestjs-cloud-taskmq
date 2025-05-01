import { applyDecorators, Controller, Post, UseGuards } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for cloud task consumer controllers
 */
export const CLOUD_TASK_CONSUMER_KEY = 'cloud_taskmq:consumer_controller';

/**
 * Cloud Task Consumer options
 */
export interface CloudTaskConsumerOptions {
  /**
   * Queue(s) that this controller will handle
   * If not specified, the controller will handle all registered queues
   */
  queues?: string[];
  
  /**
   * Path prefix for the controller (defaults to '/cloud-tasks')
   */
  path?: string;
  
  /**
   * Whether to validate OIDC tokens from Cloud Tasks (recommended for security)
   */
  validateOidcToken?: boolean;

  /**
   * Custom lock duration in milliseconds for tasks processed by this controller
   * This overrides both the global and queue-specific lock durations
   */
  lockDurationMs?: number;
}

/**
 * Marks a controller as a Cloud Task Consumer. This controller will receive
 * HTTP POST requests from Google Cloud Tasks and process them accordingly.
 * 
 * @param options Configuration options for the consumer
 * 
 * @example
 * ```typescript
 * @CloudTaskConsumer({
 *   queues: ['email-queue', 'notification-queue'],
 *   validateOidcToken: true
 * })
 * export class TasksController {
 *   constructor(private readonly cloudTaskMqService: CloudTaskMQService) {}
 *   
 *   @Post()
 *   async handleTask(@Body() payload: any, @Req() request: Request) {
 *     // The library will handle most of this for you automatically
 *     // This is a hook where you can add additional custom logic if needed
 *     return { received: true };
 *   }
 * }
 * ```
 */
export function CloudTaskConsumer(options: CloudTaskConsumerOptions = {}) {
  const path = options.path || 'cloud-tasks';
  
  // Combine decorators
  return applyDecorators(
    Controller(path),
    SetMetadata(CLOUD_TASK_CONSUMER_KEY, {
      queues: options.queues,
      validateOidcToken: options.validateOidcToken ?? true,
      lockDurationMs: options.lockDurationMs,
    }),
  );
}

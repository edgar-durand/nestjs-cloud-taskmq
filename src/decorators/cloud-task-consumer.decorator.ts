import {
  applyDecorators,
  Controller,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import { CloudTaskProcessorInterceptor } from '../interceptors/cloud-task-processor.interceptor';
import { RateLimiterOptions } from '../interfaces/config.interface';

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
   * Whether to add OIDC tokens for Cloud Tasks (recommended for security)
   */
  includeOidcToken?: boolean;

  /**
   * Custom lock duration in milliseconds for tasks processed by this controller
   * This overrides both the global and queue-specific lock durations
   */
  lockDurationMs?: number;

  /**
   * If true, the controller will automatically process tasks without requiring
   * manual calls to consumerService.processTask(). Default is true.
   */
  autoProcessTasks?: boolean;

  /**
   * Rate limiter options for controlling task processing throughput
   * When specified, tasks will be rate-limited according to these settings
   * This overrides any queue-level rate limiter options
   */
  rateLimiterOptions?: RateLimiterOptions[];
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
 *   includeOidcToken: true // Ensures OIDC token is expected/used for tasks handled by this consumer
 * })
 * export class MyTaskProcessor {
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
    UseInterceptors(CloudTaskProcessorInterceptor),
    SetMetadata(CLOUD_TASK_CONSUMER_KEY, {
      queues: options.queues,
      includeOidcToken: options.includeOidcToken ?? true,
      lockDurationMs: options.lockDurationMs,
      autoProcessTasks: options.autoProcessTasks,
      rateLimiterOptions: options.rateLimiterOptions,
    }),
  );
}

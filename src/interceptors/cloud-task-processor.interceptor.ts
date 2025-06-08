import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConsumerService } from '../services/consumer.service';
import { CLOUD_TASK_CONSUMER_KEY } from '../decorators/cloud-task-consumer.decorator';
import { ModuleRef } from '@nestjs/core';

/**
 * Interceptor that automatically processes Cloud Tasks
 * This eliminates the need to manually call processTask in your controller
 */
@Injectable()
export class CloudTaskProcessorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CloudTaskProcessorInterceptor.name);
  private consumerService: ConsumerService | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Lazily get the ConsumerService from ModuleRef to avoid circular dependency
   */
  private getConsumerService(): ConsumerService | null {
    if (!this.consumerService) {
      try {
        this.consumerService = this.moduleRef.get(ConsumerService, {
          strict: false,
        });
      } catch (error) {
        this.logger.warn(
          'Could not resolve ConsumerService - auto-processing will be disabled',
        );
        return null;
      }
    }
    return this.consumerService;
  }

  async intercept(context: ExecutionContext, next: CallHandler) {
    // Get the request body
    const req = context.switchToHttp().getRequest();
    const body = req.body;

    // Verify this is a valid task request
    if (!body || !body.taskId || !body.queueName) {
      return next.handle();
    }

    // Get controller metadata to check if auto-processing is disabled
    const controller = context.getClass();
    const metadata = Reflect.getMetadata(CLOUD_TASK_CONSUMER_KEY, controller);

    // Skip auto-processing if explicitly disabled
    if (metadata && metadata.autoProcessTasks === false) {
      return next.handle();
    }

    // Get consumer service
    const consumerService = this.getConsumerService();
    if (!consumerService) {
      this.logger.warn(
        'Cannot auto-process task: ConsumerService not available',
      );
      return next.handle();
    }

    // Process the task
    await consumerService.processTask(
      body.taskId,
      body.queueName,
      body.payload,
      body.metadata,
    );

    // Continue with request handling
    return next.handle();
  }
}

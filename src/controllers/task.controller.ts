import { Controller, Post, Body, Logger, Req, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { Request } from 'express';
import { ConsumerService } from '../services/consumer.service';

/**
 * Default controller that handles Cloud Tasks HTTP pushes.
 * This controller is created automatically by the library when you don't provide your own.
 * If you want to customize the handling, you can create your own controller with the @CloudTaskConsumer decorator.
 */
@Controller('cloud-tasks')
export class TaskController {
  private readonly logger = new Logger(TaskController.name);
  
  constructor(private readonly consumerService: ConsumerService) {}
  
  /**
   * Handles incoming HTTP POST requests from Cloud Tasks.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleTask(@Body() body: any, @Req() request: Request): Promise<any> {
    try {
      this.logger.debug(`Received Cloud Task: ${JSON.stringify(body)}`);
      
      if (!body || !body.taskId) {
        throw new HttpException('Missing taskId in request body', HttpStatus.BAD_REQUEST);
      }
      
      if (!body.queueName) {
        throw new HttpException('Missing queueName in request body', HttpStatus.BAD_REQUEST);
      }
      
      // Extract task data from the request
      const { taskId, queueName, payload, metadata } = body;
      
      // Process the task
      const result = await this.consumerService.processTask(
        taskId,
        queueName,
        payload,
        metadata,
      );
      
      return { success: true, result };
    } catch (error) {
      this.logger.error(`Error handling Cloud Task: ${error.message}`, error.stack);
      
      // Return a success response to prevent Cloud Tasks retries for business logic errors
      // The error is already logged and the task is marked as failed in the storage
      // If you want Cloud Tasks to retry, throw an HTTP exception
      
      if (error instanceof HttpException) {
        throw error; // Let HTTP exceptions pass through for Cloud Tasks to retry
      }
      
      // For other errors, return a 200 OK to prevent retries (Cloud Tasks will think it succeeded)
      // The task is already marked as failed in the storage
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

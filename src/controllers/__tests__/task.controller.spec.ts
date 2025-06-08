import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from '../task.controller';
import { ConsumerService } from '../../services/consumer.service';

import { HttpException } from '@nestjs/common';
import { CLOUD_TASKMQ_CONFIG } from '../../utils/constants';

describe('TaskController', () => {
  let controller: TaskController;
  let consumerService: ConsumerService;

  beforeEach(async () => {
    // Create consumer service mock
    consumerService = {
      processTask: jest.fn(),
    } as unknown as ConsumerService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        {
          provide: ConsumerService,
          useValue: consumerService,
        },
        {
          provide: CLOUD_TASKMQ_CONFIG,
          useValue: {
            controllerPrefix: 'tasks',
            defaultQueueName: 'default-queue',
          },
        },
      ],
    }).compile();

    controller = module.get<TaskController>(TaskController);
  });

  describe('handleTask', () => {
    it('should call consumerService.processTask with correct parameters', async () => {
      // Arrange
      const queueName = 'test-queue';
      const taskId = 'test-task-id';
      const payload = { data: 'test-payload' };
      const metadata = { meta: 'test-metadata' };
      const mockResult = { success: true, data: 'test result' };

      // Mock the processTask to return a result
      jest.spyOn(consumerService, 'processTask').mockResolvedValue(mockResult);

      // Act
      const result = await controller.handleTask({
        taskId,
        queueName,
        payload,
        metadata,
      });

      // Assert
      expect(result).toEqual({ success: true, result: mockResult });
      expect(consumerService.processTask).toHaveBeenCalledWith(
        taskId,
        queueName,
        payload,
        metadata,
      );
    });

    it('should throw HttpException when taskId is missing', async () => {
      // Arrange
      const body = {
        queueName: 'test-queue',
        payload: { data: 'test' },
      };

      // Act & Assert
      await expect(controller.handleTask(body)).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when queueName is missing', async () => {
      // Arrange
      const body = {
        taskId: 'test-task-id',
        payload: { data: 'test' },
      };

      // Act & Assert
      await expect(controller.handleTask(body)).rejects.toThrow(HttpException);
    });

    it('should handle business logic errors by returning success: false', async () => {
      // Arrange
      const body = {
        taskId: 'test-task-id',
        queueName: 'test-queue',
        payload: { data: 'test' },
      };

      const error = new Error('Business logic error');
      jest.spyOn(consumerService, 'processTask').mockRejectedValue(error);

      // Act
      const result = await controller.handleTask(body);

      // Assert
      expect(result).toEqual({
        success: false,
        error: error.message,
      });
    });

    it('should propagate HttpExceptions', async () => {
      // Arrange
      const body = {
        taskId: 'test-task-id',
        queueName: 'test-queue',
        payload: { data: 'test' },
      };

      const httpError = new HttpException('Bad request', 400);
      jest.spyOn(consumerService, 'processTask').mockRejectedValue(httpError);

      // Act & Assert
      await expect(controller.handleTask(body)).rejects.toThrow(HttpException);
    });
  });
});

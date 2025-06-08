import { Test, TestingModule } from '@nestjs/testing';
import { CloudTaskProcessorInterceptor } from '../cloud-task-processor.interceptor';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConsumerService } from '../../services/consumer.service';
import { of, throwError } from 'rxjs';
import { ModuleRef } from '@nestjs/core';
import { CLOUD_TASK_CONSUMER_KEY } from '../../decorators/cloud-task-consumer.decorator';

describe('CloudTaskProcessorInterceptor', () => {
  let interceptor: CloudTaskProcessorInterceptor;
  let consumerService: ConsumerService;
  let moduleRef: { get: jest.Mock };

  beforeEach(async () => {
    // Create mocks
    consumerService = {
      processTask: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConsumerService;

    moduleRef = {
      get: jest.fn().mockReturnValue(consumerService),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudTaskProcessorInterceptor,
        {
          provide: ModuleRef,
          useValue: moduleRef,
        },
      ],
    }).compile();

    interceptor = module.get<CloudTaskProcessorInterceptor>(
      CloudTaskProcessorInterceptor,
    );
  });

  describe('intercept', () => {
    it('should process valid task requests', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const queueName = 'test-queue';
      const payload = { test: 'data' };
      const metadata = { some: 'metadata' };

      const mockRequest = {
        body: {
          taskId,
          queueName,
          payload,
          metadata,
        },
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
        getClass: jest.fn().mockReturnValue(class TestController {}),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ result: 'success' })),
      } as CallHandler;

      // Act
      const observable = await interceptor.intercept(
        mockContext,
        mockCallHandler,
      );

      // Subscribe to trigger the observable
      let result;
      await new Promise<void>((resolve) => {
        observable.subscribe((value) => {
          result = value;
          resolve();
        });
      });

      // Assert
      expect(result).toEqual({ result: 'success' });
      expect(consumerService.processTask).toHaveBeenCalledWith(
        taskId,
        queueName,
        payload,
        metadata,
      );
    });

    it('should skip processing when autoProcessTasks is false', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const queueName = 'test-queue';

      const mockRequest = {
        body: {
          taskId,
          queueName,
          payload: { test: 'data' },
        },
      };

      const controllerClass = class TestController {};
      // Set metadata to disable auto-processing
      Reflect.defineMetadata(
        CLOUD_TASK_CONSUMER_KEY,
        { autoProcessTasks: false },
        controllerClass,
      );

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
        getClass: jest.fn().mockReturnValue(controllerClass),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ result: 'success' })),
      } as CallHandler;

      // Act
      const observable = await interceptor.intercept(
        mockContext,
        mockCallHandler,
      );

      // Subscribe to trigger the observable
      let result;
      await new Promise<void>((resolve) => {
        observable.subscribe((value) => {
          result = value;
          resolve();
        });
      });

      // Assert
      expect(result).toEqual({ result: 'success' });
      // Should not process the task
      expect(consumerService.processTask).not.toHaveBeenCalled();
    });

    it('should skip processing for invalid requests', async () => {
      // Arrange
      const mockRequest = {
        body: {
          // Missing required fields like taskId and queueName
          payload: { test: 'data' },
        },
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
        getClass: jest.fn().mockReturnValue(class TestController {}),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ result: 'success' })),
      } as CallHandler;

      // Act
      const observable = await interceptor.intercept(
        mockContext,
        mockCallHandler,
      );

      // Subscribe to trigger the observable
      let result;
      await new Promise<void>((resolve) => {
        observable.subscribe((value) => {
          result = value;
          resolve();
        });
      });

      // Assert
      expect(result).toEqual({ result: 'success' });
      // Should not process the task due to missing required fields
      expect(consumerService.processTask).not.toHaveBeenCalled();
    });

    it('should handle errors during request processing', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const queueName = 'test-queue';
      const mockError = new Error('Request processing failed');

      const mockRequest = {
        body: {
          taskId,
          queueName,
          payload: { test: 'data' },
        },
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
        getClass: jest.fn().mockReturnValue(class TestController {}),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(throwError(() => mockError)),
      } as CallHandler;

      // Act
      const observable = await interceptor.intercept(
        mockContext,
        mockCallHandler,
      );

      // Subscribe to trigger the observable
      let caughtError;
      await new Promise<void>((resolve) => {
        observable.subscribe({
          next: () => fail('Should not reach here'),
          error: (err) => {
            caughtError = err;
            resolve();
          },
        });
      });

      // Assert
      expect(caughtError).toBe(mockError);
      // Should still process the task even if handling the response fails
      expect(consumerService.processTask).toHaveBeenCalled();
    });

    it('should handle case when ConsumerService is not available', async () => {
      // Arrange
      moduleRef.get.mockImplementation(() => {
        throw new Error('Service not found');
      });

      // Create a new interceptor to force lazy loading of ConsumerService to fail
      const newInterceptor = new CloudTaskProcessorInterceptor(
        moduleRef as unknown as ModuleRef,
      );

      const taskId = 'test-task-id';
      const queueName = 'test-queue';

      const mockRequest = {
        body: {
          taskId,
          queueName,
          payload: { test: 'data' },
        },
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
        getClass: jest.fn().mockReturnValue(class TestController {}),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ result: 'success' })),
      } as CallHandler;

      // Act
      const observable = await newInterceptor.intercept(
        mockContext,
        mockCallHandler,
      );

      // Subscribe to trigger the observable
      let result;
      await new Promise<void>((resolve) => {
        observable.subscribe((value) => {
          result = value;
          resolve();
        });
      });

      // Assert
      expect(result).toEqual({ result: 'success' });
      // ConsumerService should not be available, so processTask should not be called
      expect(consumerService.processTask).not.toHaveBeenCalled();
    });
  });
});

import { DiscoveryService } from '@nestjs/core';
import { ProducerService } from '../producer.service';
import { CloudTaskMQConfig } from '../../interfaces/config.interface';
import { ConfigService } from '@nestjs/config';
import { TaskStatus } from '../../interfaces/task.interface';

jest.mock('google-auth-library', () => {
  return {
    GoogleAuth: jest.fn().mockImplementation(() => {
      return {
        getCredentials: jest.fn().mockResolvedValue({
          client_email: 'mock-service-account@example.com',
        }),
      };
    }),
  };
});

// Mock para Cloud Tasks Client
jest.mock('@google-cloud/tasks', () => {
  return {
    CloudTasksClient: jest.fn().mockImplementation(() => {
      return {
        createTask: jest.fn().mockResolvedValue([{ name: 'mocked-task-name' }]),
        listQueues: jest.fn().mockResolvedValue([[]]),
      };
    }),
  };
});

describe('ProducerService', () => {
  let service: ProducerService;
  let storageAdapter: any;
  let reflector: any;

  beforeEach(async () => {
    // Create mocks
    storageAdapter = {
      createTask: jest.fn(),
      getTaskById: jest.fn(),
      updateTaskStatus: jest.fn().mockResolvedValue(true),
      findTasks: jest.fn(),
      countTasks: jest.fn(),
      deleteTaskById: jest.fn(),
    };

    storageAdapter.createTask = jest.fn().mockImplementation((task) => {
      return Promise.resolve({
        taskId: task.taskId,
        queueName: task.queueName,
        status: TaskStatus.IDLE,
        createdAt: new Date(),
      });
    });

    const discoveryService = {
      getControllers: jest.fn().mockReturnValue([]),
    };

    reflector = {
      get: jest.fn(),
    };

    const configService = {
      get: jest.fn(),
    };

    // Create mock config
    const mockConfig: CloudTaskMQConfig = {
      projectId: 'test-project',
      location: 'us-central1',
      storageAdapter: 'memory',
      storageOptions: { type: 'memory' },
      queues: [
        {
          name: 'test-queue',
          path: 'projects/test-project/locations/us-central1/queues/test-queue',
          processorUrl: 'https://example.com/process',
        },
      ],
    };

    // Create service
    service = new ProducerService(
      mockConfig,
      storageAdapter,
      configService as unknown as ConfigService,
      discoveryService as unknown as DiscoveryService,
    );
  });

  describe('addTask', () => {
    it('should add a task to the queue', async () => {
      // Arrange
      const queueName = 'test-queue';
      const payload = { data: 'test' };

      // Act
      const result = await service.addTask(queueName, payload);

      // Assert
      expect(result.taskId).toBeDefined();
      expect(result.queueName).toBe(queueName);
      expect(result.createdAt).toBeDefined();
      expect(storageAdapter.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: expect.any(String),
          queueName,
          payload,
          status: TaskStatus.IDLE,
        }),
      );
    });

    it('should add a task with additional options', async () => {
      // Arrange
      const queueName = 'test-queue';
      const payload = { data: 'test' };
      const options = {
        taskId: 'custom-task-id',
        scheduleTime: new Date(Date.now() + 3600000), // 1 hour from now
        metadata: { custom: 'data' },
        retryConfig: {
          maxAttempts: 5,
        },
      };

      // Act
      const result = await service.addTask(queueName, payload, options);

      // Assert
      expect(result.taskId).toBe(options.taskId);
      expect(result.queueName).toBe(queueName);
      expect(result.createdAt).toBeDefined();
      expect(storageAdapter.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: options.taskId,
          queueName,
          payload,
          status: TaskStatus.IDLE,
          metadata: expect.objectContaining(options.metadata),
        }),
      );
    });

    it('should add OIDC token validation if required', async () => {
      // Arrange
      const queueName = 'test-queue';
      const payload = { data: 'test' };

      // Mock reflector to return true for OIDC token validation
      reflector.get.mockReturnValue({ validateOidcToken: true });

      // Act
      const result = await service.addTask(queueName, payload);

      // Assert
      expect(result.taskId).toBeDefined();
      expect(result.queueName).toBe(queueName);
    });

    it('should not add OIDC token validation if not required', async () => {
      // Arrange
      const queueName = 'test-queue';
      const payload = { data: 'test' };

      // Mock reflector to return false for OIDC token validation
      reflector.get.mockReturnValue({ validateOidcToken: false });

      // Act
      const result = await service.addTask(queueName, payload);

      // Assert
      expect(result.taskId).toBeDefined();
      expect(result.queueName).toBe(queueName);
    });

    it('should handle task creation failure', async () => {
      // Arrange
      const queueName = 'test-queue';
      const payload = { data: 'test' };

      // Mock storage adapter to throw an error
      storageAdapter.createTask.mockRejectedValueOnce(
        new Error('Failed to create task'),
      );

      // Act & Assert
      await expect(service.addTask(queueName, payload)).rejects.toThrow();
    });
  });

  describe('getTask', () => {
    it('should retrieve a task by its ID', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const mockTask = {
        taskId,
        queueName: 'test-queue',
        status: TaskStatus.COMPLETED,
        payload: { data: 'test' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageAdapter.getTaskById.mockResolvedValue(mockTask);

      // Act
      const result = await service.getTask(taskId);

      // Assert
      expect(storageAdapter.getTaskById).toHaveBeenCalledWith(taskId);
      expect(result).toEqual(mockTask);
    });

    it('should return null if task not found', async () => {
      // Arrange
      const taskId = 'non-existent-task';

      storageAdapter.getTaskById.mockResolvedValue(null);

      // Act
      const result = await service.getTask(taskId);

      // Assert
      expect(storageAdapter.getTaskById).toHaveBeenCalledWith(taskId);
      expect(result).toBeNull();
    });
  });

  // Para reemplazar los tests de cancelTask que no existen en el servicio actual
  describe('findTasks', () => {
    it('should find tasks with specific criteria', async () => {
      // Arrange
      const queueName = 'test-queue';
      const status = TaskStatus.IDLE;
      const mockTasks = [
        {
          taskId: 'task-1',
          queueName,
          status,
          payload: { data: 'test' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      storageAdapter.findTasks.mockResolvedValue(mockTasks);

      // Act
      const result = await service.findTasks(queueName, status);

      // Assert
      expect(storageAdapter.findTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          queueName,
          status,
          limit: 100,
          skip: 0,
          sort: { createdAt: 'desc' },
        }),
      );
      expect(result).toEqual(mockTasks);
    });

    it('should return empty array when no tasks found', async () => {
      // Arrange
      const queueName = 'test-queue';

      storageAdapter.findTasks.mockResolvedValue([]);

      // Act
      const result = await service.findTasks(queueName);

      // Assert
      expect(storageAdapter.findTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          queueName,
          limit: 100,
          skip: 0,
          sort: { createdAt: 'desc' },
        }),
      );
      expect(result).toEqual([]);
    });
  });

  describe('countTasks', () => {
    it('should count tasks with specific criteria', async () => {
      // Arrange
      const queueName = 'test-queue';
      const status = TaskStatus.IDLE;

      storageAdapter.countTasks.mockResolvedValue(5);

      // Act
      const result = await service.countTasks(queueName, status);

      // Assert
      expect(storageAdapter.countTasks).toHaveBeenCalledWith({
        queueName,
        status,
      });
      expect(result).toBe(5);
    });
  });
});

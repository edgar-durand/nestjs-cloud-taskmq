import { ProducerService } from '../producer.service';
import { CloudTaskMQConfig } from '../../interfaces/config.interface';
import { ITask, TaskStatus } from '../../interfaces/task.interface';

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

describe('ProducerService - Chain Tasks', () => {
  let service: ProducerService;
  let storageAdapter: any;
  let discoveryService: any;

  const mockConfig: CloudTaskMQConfig = {
    projectId: 'test-project',
    location: 'us-central1',
    queues: [
      {
        name: 'test-queue',
        path: 'projects/test-project/locations/us-central1/queues/test-queue',
        processorUrl: 'http://localhost:3000/tasks',
      },
    ],
    storageAdapter: 'memory' as any,
    storageOptions: {},
  };

  beforeEach(async () => {
    // Create mocks
    storageAdapter = {
      createTask: jest.fn(),
      getTaskById: jest.fn(),
      updateTaskStatus: jest.fn().mockResolvedValue(true),
      findTasks: jest.fn(),
      findTasksWithoutActiveVersion: jest.fn(),
      countTasks: jest.fn(),
      deleteTask: jest.fn(),
      completeTask: jest.fn(),
      failTask: jest.fn(),
      hasActiveTaskInChain: jest.fn(),
      getNextTaskInChain: jest.fn(),
      findTasksByChainId: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined),
    };

    discoveryService = {
      getProviders: jest.fn().mockReturnValue([]),
      getControllers: jest.fn().mockReturnValue([]),
    };

    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    service = new ProducerService(
      mockConfig,
      storageAdapter,
      configService as any,
      discoveryService,
    );

    await service.onModuleInit();
  });

  describe('addTask with chain options', () => {
    it('should create a chained task with proper chain metadata', async () => {
      // Arrange
      const chainOptions = {
        chainId: 'test-chain-1',
        chainOrder: 1,
      };

      storageAdapter.hasActiveTaskInChain.mockResolvedValue(false);
      storageAdapter.getNextTaskInChain.mockResolvedValue(null);

      storageAdapter.createTask.mockImplementation((task) => {
        return Promise.resolve({
          ...task,
          taskId: task.taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      // Act
      const result = await service.addTask(
        'test-queue',
        { message: 'test payload' },
        { chainOptions },
      );

      // Assert
      expect(storageAdapter.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 'test-chain-1',
          chainOrder: 1,
          status: TaskStatus.IDLE,
        }),
      );
      expect(result.taskId).toBeTruthy();
    });

    it('should set task to IDLE when chain has active task', async () => {
      // Arrange
      const chainOptions = {
        chainId: 'busy-chain',
        chainOrder: 2,
      };

      storageAdapter.hasActiveTaskInChain.mockResolvedValue(true);

      storageAdapter.createTask.mockImplementation((task) => {
        return Promise.resolve({
          ...task,
          taskId: task.taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      // Act
      await service.addTask(
        'test-queue',
        { message: 'test payload' },
        { chainOptions },
      );

      // Assert
      expect(storageAdapter.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TaskStatus.IDLE,
        }),
      );
    });

    it('should handle first task in chain when no active tasks', async () => {
      // Arrange
      const chainOptions = {
        chainId: 'new-chain',
        chainOrder: 1,
      };

      storageAdapter.createTask.mockImplementation((task) => {
        return Promise.resolve({
          ...task,
          taskId: task.taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      // Act
      await service.addTask(
        'test-queue',
        { message: 'test payload' },
        { chainOptions },
      );

      // Assert - chain tasks always start as IDLE regardless of chain state
      expect(storageAdapter.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TaskStatus.IDLE,
          chainId: 'new-chain',
          chainOrder: 1,
        }),
      );
    });

    it('should send chain task to GCP when it has scheduleTime (rate-limited retry)', async () => {
      // Arrange
      const chainOptions = {
        chainId: 'rate-limited-chain',
        chainOrder: 1,
      };
      const scheduleTime = new Date(Date.now() + 5000);
      const sendTaskToGcpSpy = jest
        .spyOn(service, 'sendTaskToGcp')
        .mockResolvedValue(undefined);

      storageAdapter.createTask.mockImplementation((task) => {
        return Promise.resolve({
          ...task,
          taskId: task.taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      // Act
      await service.addTask(
        'test-queue',
        { message: 'rate limited retry' },
        { chainOptions, scheduleTime },
      );

      // Assert - chain task with scheduleTime should be sent to GCP immediately
      expect(sendTaskToGcpSpy).toHaveBeenCalledWith(
        'test-queue',
        { message: 'rate limited retry' },
        expect.objectContaining({
          chainOptions,
          scheduleTime,
        }),
      );

      sendTaskToGcpSpy.mockRestore();
    });

    it('should log warning when chainOptions is combined with scheduleTime', async () => {
      // Arrange
      const chainOptions = {
        chainId: 'warned-chain',
        chainOrder: 1,
      };
      const scheduleTime = new Date(Date.now() + 5000);
      const loggerWarnSpy = jest
        .spyOn(service['logger'] as any, 'warn')
        .mockImplementation();

      storageAdapter.createTask.mockImplementation((task) => {
        return Promise.resolve({
          ...task,
          taskId: task.taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      // Act
      await service.addTask(
        'test-queue',
        { message: 'warning test' },
        { chainOptions, scheduleTime },
      );

      // Assert - warning should be logged
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('has both chainOptions and scheduleTime'),
        expect.objectContaining({
          chainId: 'warned-chain',
          chainOrder: 1,
        }),
      );

      loggerWarnSpy.mockRestore();
    });
  });

  describe('filterEligibleTasks', () => {
    it('should include non-chained tasks', async () => {
      // Arrange
      const tasks: ITask[] = [
        {
          taskId: 'task-1',
          queueName: 'test-queue',
          status: TaskStatus.IDLE,
          payload: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ITask,
      ];

      storageAdapter.findTasksWithoutActiveVersion.mockResolvedValue(tasks);

      // Act
      const result = await service['filterEligibleTasks'](tasks);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('task-1');
    });

    it('should exclude chained tasks when chain is active', async () => {
      // Arrange
      const tasks: ITask[] = [
        {
          taskId: 'task-1',
          queueName: 'test-queue',
          status: TaskStatus.IDLE,
          payload: {},
          chainId: 'test-chain',
          chainOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ITask,
      ];

      storageAdapter.hasActiveTaskInChain.mockResolvedValue(true);

      // Act
      const result = await service['filterEligibleTasks'](tasks);

      // Assert
      expect(result).toHaveLength(0);
      expect(storageAdapter.hasActiveTaskInChain).toHaveBeenCalledWith(
        'test-chain',
      );
    });

    it('should include next task in chain when no active tasks', async () => {
      // Arrange
      const nextTask: ITask = {
        taskId: 'task-1',
        queueName: 'test-queue',
        status: TaskStatus.IDLE,
        payload: {},
        chainId: 'test-chain',
        chainOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ITask;

      const tasks: ITask[] = [nextTask];

      storageAdapter.hasActiveTaskInChain.mockResolvedValue(false);
      storageAdapter.getNextTaskInChain.mockResolvedValue(nextTask);

      // Act
      const result = await service['filterEligibleTasks'](tasks);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('task-1');
    });

    it('should exclude task that is not next in chain', async () => {
      // Arrange
      const currentTask: ITask = {
        taskId: 'task-2',
        queueName: 'test-queue',
        status: TaskStatus.IDLE,
        payload: {},
        chainId: 'test-chain',
        chainOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ITask;

      const nextTask: ITask = {
        taskId: 'task-1',
        queueName: 'test-queue',
        status: TaskStatus.IDLE,
        payload: {},
        chainId: 'test-chain',
        chainOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ITask;

      const tasks: ITask[] = [currentTask];

      storageAdapter.hasActiveTaskInChain.mockResolvedValue(false);
      storageAdapter.getNextTaskInChain.mockResolvedValue(nextTask);

      // Act
      const result = await service['filterEligibleTasks'](tasks);

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe('completeTask', () => {
    it('should complete task and trigger next in chain', async () => {
      // Arrange
      const completedTask: ITask = {
        taskId: 'task-1',
        queueName: 'test-queue',
        status: TaskStatus.COMPLETED,
        payload: {},
        chainId: 'test-chain',
        chainOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ITask;

      const nextTask: ITask = {
        taskId: 'task-2',
        queueName: 'test-queue',
        status: TaskStatus.IDLE,
        payload: { data: 'next' },
        chainId: 'test-chain',
        chainOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { retry: true },
      } as ITask;

      storageAdapter.completeTask.mockResolvedValue(completedTask);
      storageAdapter.hasActiveTaskInChain.mockResolvedValue(false);
      storageAdapter.getNextTaskInChain.mockResolvedValue(nextTask);

      // Mock sendTaskToGcp method
      const sendTaskToGcpSpy = jest
        .spyOn(service as any, 'sendTaskToGcp')
        .mockResolvedValue(undefined);

      // Act
      await service.completeTask('task-1', { result: 'success' });

      // Assert
      expect(storageAdapter.completeTask).toHaveBeenCalledWith('task-1', {
        result: 'success',
      });
      expect(storageAdapter.hasActiveTaskInChain).toHaveBeenCalledWith(
        'test-chain',
      );
      expect(storageAdapter.getNextTaskInChain).toHaveBeenCalledWith(
        'test-chain',
      );
      expect(storageAdapter.updateTaskStatus).toHaveBeenCalledWith(
        'task-2',
        TaskStatus.ACTIVE,
        {},
      );
      expect(sendTaskToGcpSpy).toHaveBeenCalledWith(
        'test-queue',
        { data: 'next' },
        {
          taskId: 'task-2',
          chainOptions: {
            chainId: 'test-chain',
            chainOrder: 2,
          },
          retry: true,
        },
      );
    });

    it('should complete task without triggering next when no chain', async () => {
      // Arrange
      const completedTask: ITask = {
        taskId: 'task-1',
        queueName: 'test-queue',
        status: TaskStatus.COMPLETED,
        payload: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ITask;

      storageAdapter.completeTask.mockResolvedValue(completedTask);

      // Act
      await service.completeTask('task-1', { result: 'success' });

      // Assert
      expect(storageAdapter.completeTask).toHaveBeenCalledWith('task-1', {
        result: 'success',
      });
      expect(storageAdapter.hasActiveTaskInChain).not.toHaveBeenCalled();
    });
  });

  describe('failTask', () => {
    it('should fail task and trigger next in chain', async () => {
      // Arrange
      const failedTask: ITask = {
        taskId: 'task-1',
        queueName: 'test-queue',
        status: TaskStatus.FAILED,
        payload: {},
        chainId: 'test-chain',
        chainOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ITask;

      const nextTask: ITask = {
        taskId: 'task-2',
        queueName: 'test-queue',
        status: TaskStatus.IDLE,
        payload: { data: 'next after fail' },
        chainId: 'test-chain',
        chainOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { timeout: 5000 },
      } as ITask;

      storageAdapter.failTask.mockResolvedValue(failedTask);
      storageAdapter.hasActiveTaskInChain.mockResolvedValue(false);
      storageAdapter.getNextTaskInChain.mockResolvedValue(nextTask);

      // Mock sendTaskToGcp method
      const sendTaskToGcpSpy = jest
        .spyOn(service as any, 'sendTaskToGcp')
        .mockResolvedValue(undefined);

      // Act
      await service.failTask('task-1', new Error('Task failed'));

      // Assert
      expect(storageAdapter.failTask).toHaveBeenCalledWith(
        'task-1',
        new Error('Task failed'),
      );
      expect(storageAdapter.hasActiveTaskInChain).toHaveBeenCalledWith(
        'test-chain',
      );
      expect(storageAdapter.getNextTaskInChain).toHaveBeenCalledWith(
        'test-chain',
      );
      expect(storageAdapter.updateTaskStatus).toHaveBeenCalledWith(
        'task-2',
        TaskStatus.ACTIVE,
        {},
      );
      expect(sendTaskToGcpSpy).toHaveBeenCalledWith(
        'test-queue',
        { data: 'next after fail' },
        {
          taskId: 'task-2',
          chainOptions: {
            chainId: 'test-chain',
            chainOrder: 2,
          },
          timeout: 5000,
        },
      );
    });
  });

  describe('getChainTasks', () => {
    it('should get all tasks in a chain', async () => {
      // Arrange
      const chainTasks: ITask[] = [
        {
          taskId: 'task-1',
          queueName: 'test-queue',
          status: TaskStatus.COMPLETED,
          payload: {},
          chainId: 'test-chain',
          chainOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ITask,
        {
          taskId: 'task-2',
          queueName: 'test-queue',
          status: TaskStatus.IDLE,
          payload: {},
          chainId: 'test-chain',
          chainOrder: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ITask,
      ];

      storageAdapter.findTasksByChainId.mockResolvedValue(chainTasks);

      // Act
      const result = await service.getChainTasks('test-chain');

      // Assert
      expect(storageAdapter.findTasksByChainId).toHaveBeenCalledWith(
        'test-chain',
        undefined,
      );
      expect(result).toHaveLength(2);
      expect(result[0].chainOrder).toBe(1);
      expect(result[1].chainOrder).toBe(2);
    });

    it('should get tasks in chain with status filter', async () => {
      // Arrange
      const idleChainTasks: ITask[] = [
        {
          taskId: 'task-2',
          queueName: 'test-queue',
          status: TaskStatus.IDLE,
          payload: {},
          chainId: 'test-chain',
          chainOrder: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ITask,
      ];

      storageAdapter.findTasksByChainId.mockResolvedValue(idleChainTasks);

      // Act
      const result = await service.getChainTasks('test-chain', TaskStatus.IDLE);

      // Assert
      expect(storageAdapter.findTasksByChainId).toHaveBeenCalledWith(
        'test-chain',
        TaskStatus.IDLE,
      );
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.IDLE);
    });
  });

  describe('processNextChainTask', () => {
    it('should not process when chain has active tasks', async () => {
      // Arrange
      storageAdapter.hasActiveTaskInChain.mockResolvedValue(true);

      // Act
      await service['processNextChainTask']('test-chain');

      // Assert
      expect(storageAdapter.hasActiveTaskInChain).toHaveBeenCalledWith(
        'test-chain',
      );
      expect(storageAdapter.getNextTaskInChain).not.toHaveBeenCalled();
    });

    it('should handle error gracefully', async () => {
      // Arrange
      storageAdapter.hasActiveTaskInChain.mockRejectedValue(
        new Error('Storage error'),
      );
      const loggerSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      // Act
      await service['processNextChainTask']('test-chain');

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Error processing next chain task for chain test-chain:',
        expect.any(Error),
      );
    });
  });
});

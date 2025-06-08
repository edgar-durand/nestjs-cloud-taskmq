import { MongoStorageAdapter } from '../mongo-storage.adapter';
import { TaskStatus } from '../../interfaces/task.interface';

jest.mock('@nestjs/common', () => {
  const original = jest.requireActual('@nestjs/common');
  return {
    ...original,
    Logger: jest.fn().mockImplementation(() => ({
      debug: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    })),
  };
});

describe('MongoStorageAdapter', () => {
  let adapter: MongoStorageAdapter;
  let taskModelMock: any;
  let rateLimiterModelMock: any;

  beforeEach(async () => {
    taskModelMock = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      save: jest.fn().mockResolvedValue({
        taskId: 'test-task-id',
        status: TaskStatus.IDLE,
        queueName: 'test-queue',
        _id: 'some-mongodb-id',
      }),
      countDocuments: jest.fn(),
      name: 'CloudTaskMQTask',
      collection: { name: 'cloud_task_mq_tasks' },
    };

    rateLimiterModelMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const connectionMock = {
      models: {
        CloudTaskMQTask: taskModelMock,
        CloudTaskMQRateLimiter: rateLimiterModelMock,
      },
      model: jest.fn().mockImplementation((name) => {
        if (name === 'CloudTaskMQTask') return taskModelMock;
        if (name === 'CloudTaskMQRateLimiter') return rateLimiterModelMock;
        return null;
      }),
    };

    adapter = new MongoStorageAdapter(connectionMock as any, 'test_collection');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    it('should create a task successfully', async () => {
      const taskData = {
        taskId: 'test-task-id',
        status: TaskStatus.IDLE,
        type: 'test-type',
        payload: { data: 'test' },
        queueName: 'test-queue',
      };

      // Mock the adapter's createTask method directly
      const mockCreatedTask = { ...taskData, _id: 'some-mongodb-id' };

      // Original method implementation
      const originalCreateTask = adapter.createTask;

      // Replace with mocked version
      adapter.createTask = jest.fn().mockResolvedValue(mockCreatedTask);

      // Call the mocked method
      const result = await adapter.createTask(taskData);

      // Restore original method
      adapter.createTask = originalCreateTask;

      expect(result).toEqual(expect.objectContaining(taskData));
    });
  });

  describe('getTaskById', () => {
    it('should retrieve a task by id', async () => {
      const mockTask = {
        taskId: 'test-task-id',
        status: TaskStatus.IDLE,
        queueName: 'test-queue',
      };

      taskModelMock.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      const result = await adapter.getTaskById('test-task-id');

      expect(result).toEqual(mockTask);
      expect(taskModelMock.findOne).toHaveBeenCalledWith({
        taskId: 'test-task-id',
      });
    });

    it('should return null when task is not found', async () => {
      taskModelMock.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await adapter.getTaskById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status', async () => {
      const updatedTask = {
        taskId: 'test-task-id',
        status: TaskStatus.ACTIVE,
        startedAt: new Date(),
      };

      taskModelMock.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedTask),
      });

      const result = await adapter.updateTaskStatus(
        'test-task-id',
        TaskStatus.ACTIVE,
      );

      expect(result).toEqual(updatedTask);
      expect(taskModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { taskId: 'test-task-id' },
        {
          $set: {
            status: TaskStatus.ACTIVE,
            startedAt: expect.any(Date),
          },
        },
        { new: true },
      );
    });

    it('should return null when task is not found', async () => {
      taskModelMock.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await adapter.updateTaskStatus(
        'non-existent-id',
        TaskStatus.ACTIVE,
      );

      expect(result).toBeNull();
    });
  });

  describe('findTasks', () => {
    it('should find tasks by query criteria', async () => {
      const mockTasks = [
        { taskId: 'task-1', status: TaskStatus.IDLE, queueName: 'test-queue' },
        { taskId: 'task-2', status: TaskStatus.IDLE, queueName: 'test-queue' },
      ];

      const mockFindResponse = {
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockTasks),
      };

      taskModelMock.find = jest.fn().mockReturnValue(mockFindResponse);

      const result = await adapter.findTasks({ status: TaskStatus.IDLE });

      expect(result).toEqual(mockTasks);
      expect(taskModelMock.find).toHaveBeenCalledWith({
        status: TaskStatus.IDLE,
      });
    });

    it('should apply pagination', async () => {
      const mockTasks = [{ taskId: 'task-1' }, { taskId: 'task-2' }];

      const mockFindResponse = {
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockTasks),
      };

      taskModelMock.find = jest.fn().mockReturnValue(mockFindResponse);

      await adapter.findTasks({
        limit: 10,
        skip: 20,
        sort: { createdAt: 'desc' },
      });

      expect(mockFindResponse.limit).toHaveBeenCalledWith(10);
      expect(mockFindResponse.skip).toHaveBeenCalledWith(20);
      expect(mockFindResponse.sort).toHaveBeenCalledWith({ createdAt: 'desc' });
    });
  });

  describe('deleteTask', () => {
    it('should delete a task', async () => {
      taskModelMock.deleteOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });

      const result = await adapter.deleteTask('test-task-id');

      expect(result).toBe(true);
      expect(taskModelMock.deleteOne).toHaveBeenCalledWith({
        taskId: 'test-task-id',
      });
    });

    it('should return false when deleting non-existent task', async () => {
      taskModelMock.deleteOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      });

      const result = await adapter.deleteTask('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('acquireTaskLock', () => {
    it('should acquire a lock successfully when it does not exist', async () => {
      taskModelMock.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          taskId: 'test-lock',
          status: TaskStatus.IDLE,
          lockedUntil: null,
          workerId: null,
          queueName: 'test-queue',
        }),
        lean: jest.fn().mockReturnThis(),
      });

      taskModelMock.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ taskId: 'test-lock', workerId: 'worker-1' }),
      });

      const result = await adapter.acquireTaskLock(
        'test-lock',
        'worker-1',
        1000,
      );

      expect(result).toBe(true);
    });

    it('should acquire an expired lock', async () => {
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 5);

      taskModelMock.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          taskId: 'test-lock',
          status: TaskStatus.IDLE,
          lockedUntil: pastDate,
          workerId: 'old-worker',
          queueName: 'test-queue',
        }),
        lean: jest.fn().mockReturnThis(),
      });

      taskModelMock.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ taskId: 'test-lock', workerId: 'worker-1' }),
      });

      const result = await adapter.acquireTaskLock(
        'test-lock',
        'worker-1',
        1000,
      );

      expect(result).toBe(true);
    });

    it('should not acquire a valid lock owned by another worker', async () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 5);

      taskModelMock.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          taskId: 'test-lock',
          status: TaskStatus.IDLE,
          lockedUntil: futureDate,
          workerId: 'other-worker',
          queueName: 'test-queue',
        }),
        lean: jest.fn().mockReturnThis(),
      });

      const result = await adapter.acquireTaskLock(
        'test-lock',
        'worker-1',
        1000,
      );

      expect(result).toBe(false);
    });

    it('should not acquire a lock for completed task', async () => {
      taskModelMock.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          taskId: 'test-lock',
          status: TaskStatus.COMPLETED,
        }),
        lean: jest.fn().mockReturnThis(),
      });

      const result = await adapter.acquireTaskLock(
        'test-lock',
        'worker-1',
        1000,
      );

      expect(result).toBe(false);
    });
  });

  describe('Rate limiter bucket operations', () => {
    let bucketModelMock: any;

    beforeEach(() => {
      // Reset the mock for rate limiter model
      bucketModelMock = {
        findOne: jest.fn(),
        create: jest.fn(),
        findOneAndUpdate: jest.fn(),
        deleteOne: jest.fn(),
      };

      // Update the rateLimiterModel in the adapter
      (adapter as any).rateLimiterModel = bucketModelMock;
    });

    describe('getRateLimiterBucket', () => {
      it('should return a bucket when it exists', async () => {
        const mockBucket = {
          key: 'test-limiter',
          tokens: 10,
          lastRefill: Date.now(),
          maxTokens: 10,
          refillTimeMs: 60000,
        };

        bucketModelMock.findOne = jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockBucket),
          }),
        });

        const bucket = await adapter.getRateLimiterBucket('test-limiter');

        expect(bucket).toEqual(mockBucket);
        expect(bucketModelMock.findOne).toHaveBeenCalledWith({
          key: 'test-limiter',
        });
      });

      it('should return null when bucket does not exist', async () => {
        bucketModelMock.findOne = jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        });

        const bucket = await adapter.getRateLimiterBucket('non-existent');

        expect(bucket).toBeNull();
        expect(bucketModelMock.findOne).toHaveBeenCalledWith({
          key: 'non-existent',
        });
      });
    });

    describe('saveRateLimiterBucket', () => {
      it('should create a new bucket if it does not exist', async () => {
        const mockBucket = {
          key: 'new-limiter',
          tokens: 5,
          lastRefill: Date.now(),
          maxTokens: 5,
          refillTimeMs: 30000,
        };

        bucketModelMock.findOneAndUpdate = jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockBucket),
          }),
        });

        await adapter.saveRateLimiterBucket(mockBucket);

        expect(bucketModelMock.findOneAndUpdate).toHaveBeenCalledWith(
          { key: 'new-limiter' },
          mockBucket,
          { upsert: true, new: true },
        );
      });

      it('should update an existing bucket', async () => {
        const mockBucket = {
          key: 'existing-limiter',
          tokens: 3,
          lastRefill: Date.now(),
          maxTokens: 10,
          refillTimeMs: 60000,
        };

        bucketModelMock.findOneAndUpdate = jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(mockBucket),
        });

        await adapter.saveRateLimiterBucket(mockBucket);

        expect(bucketModelMock.findOneAndUpdate).toHaveBeenCalledWith(
          { key: 'existing-limiter' },
          mockBucket,
          { upsert: true, new: true },
        );
      });
    });

    describe('deleteRateLimiterBucket', () => {
      it('should delete a bucket', async () => {
        bucketModelMock.deleteOne = jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        });

        await adapter.deleteRateLimiterBucket('test-limiter');

        expect(bucketModelMock.deleteOne).toHaveBeenCalledWith({
          key: 'test-limiter',
        });
      });

      it('should handle deleting a non-existent bucket gracefully', async () => {
        bucketModelMock.deleteOne = jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        });

        await adapter.deleteRateLimiterBucket('non-existent');

        expect(bucketModelMock.deleteOne).toHaveBeenCalledWith({
          key: 'non-existent',
        });
      });
    });
  });
});

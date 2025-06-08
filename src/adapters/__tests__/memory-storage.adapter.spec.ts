import { Test } from '@nestjs/testing';
import { MemoryStorageAdapter } from '../memory-storage.adapter';
import { CloudTask } from '../../models/cloud-task.model';
import { TaskStatus } from '../../interfaces/task.interface';

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MemoryStorageAdapter],
    }).compile();

    adapter = moduleRef.get<MemoryStorageAdapter>(MemoryStorageAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    it('should save a task', async () => {
      // Arrange
      const task = new CloudTask({
        taskId: 'test-task-id',
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      const result = await adapter.createTask(task);

      // Assert
      expect(result).toBeTruthy();
      expect(result.taskId).toBe(task.taskId);
    });
  });

  describe('getTaskById', () => {
    it('should return null if task does not exist', async () => {
      // Act
      const result = await adapter.getTaskById('non-existent-id');

      // Assert
      expect(result).toBeNull();
    });

    it('should get a task by id', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const task = new CloudTask({
        taskId,
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const savedTask = await adapter.createTask(task);

      // Act
      const result = await adapter.getTaskById(taskId);

      // Assert
      expect(result).toEqual(savedTask);
    });
  });

  describe('updateTaskStatus', () => {
    it('should update a task', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const task = new CloudTask({
        taskId,
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await adapter.createTask(task);

      // Act
      const updated = await adapter.updateTaskStatus(
        taskId,
        TaskStatus.ACTIVE,
        {
          metadata: { someValue: 50 },
        },
      );

      // Assert
      expect(updated).toBeTruthy();
      const updatedTask = await adapter.getTaskById(taskId);
      expect(updatedTask.status).toBe(TaskStatus.ACTIVE);
      expect(updatedTask.metadata?.someValue).toBe(50);
    });

    it('should return null when updating non-existent task', async () => {
      // Act
      const result = await adapter.updateTaskStatus(
        'non-existent-id',
        TaskStatus.ACTIVE,
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findTasks', () => {
    beforeEach(async () => {
      // Populate with some test tasks
      const tasks = [
        new CloudTask({
          taskId: 'task-1',
          queueName: 'queue-1',
          status: TaskStatus.IDLE,
          progress: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          payload: {}, // Add missing required property
        }),
        new CloudTask({
          taskId: 'task-2',
          queueName: 'queue-1',
          status: TaskStatus.ACTIVE,
          progress: 50,
          createdAt: new Date(),
          updatedAt: new Date(),
          payload: {}, // Add missing required property
        }),
        new CloudTask({
          taskId: 'task-3',
          queueName: 'queue-2',
          status: TaskStatus.IDLE,
          progress: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          payload: {}, // Add missing required property
        }),
      ];

      for (const task of tasks) {
        await adapter.createTask(task);
      }
    });

    it('should find tasks by queue name', async () => {
      // Act
      const result = await adapter.findTasks({ queueName: 'queue-1' });

      // Assert
      expect(result.length).toBe(2);
      expect(result.every((task) => task.queueName === 'queue-1')).toBe(true);
    });

    it('should find tasks by status', async () => {
      // Act
      const result = await adapter.findTasks({ status: TaskStatus.IDLE });

      // Assert
      expect(result.length).toBe(2);
      expect(result.every((task) => task.status === TaskStatus.IDLE)).toBe(
        true,
      );
    });

    it('should find tasks by multiple criteria', async () => {
      // Act
      const result = await adapter.findTasks({
        queueName: 'queue-1',
        status: TaskStatus.ACTIVE,
      });

      // Assert
      expect(result.length).toBe(1);
      expect(result[0].taskId).toBe('task-2');
    });
  });

  describe('deleteTask', () => {
    it('should delete a task', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const task = new CloudTask({
        taskId,
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await adapter.createTask(task);

      // Act
      const deleted = await adapter.deleteTask(taskId);
      const deletedTask = await adapter.getTaskById(taskId);

      // Assert
      expect(deleted).toBe(true);
      expect(deletedTask).toBeNull();
    });

    it('should return false when deleting non-existent task', async () => {
      // Act
      const result = await adapter.deleteTask('non-existent-id');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('acquireTaskLock', () => {
    it('should acquire a lock successfully', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const task = new CloudTask({
        taskId,
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await adapter.createTask(task);

      // Act
      const result = await adapter.acquireTaskLock(taskId, 'worker-1', 1000);

      // Assert
      expect(result).toBe(true);
    });

    it('should not acquire a lock if already locked by another worker', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const task = new CloudTask({
        taskId,
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await adapter.createTask(task);

      await adapter.acquireTaskLock(taskId, 'worker-1', 1000);

      // Act
      const result = await adapter.acquireTaskLock(taskId, 'worker-2', 1000);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('releaseTaskLock', () => {
    it('should release a lock successfully', async () => {
      // Arrange
      const taskId = 'test-task-id';
      const task = new CloudTask({
        taskId,
        queueName: 'test-queue',
        payload: { test: 'data' },
        status: TaskStatus.IDLE,
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await adapter.createTask(task);

      const workerId = 'worker-1';
      await adapter.acquireTaskLock(taskId, workerId, 1000);

      // Act
      const released = await adapter.releaseTaskLock(taskId, workerId);
      const canAcquireAgain = await adapter.acquireTaskLock(
        taskId,
        'worker-2',
        1000,
      );

      // Assert
      expect(released).toBe(true);
      expect(canAcquireAgain).toBe(true);
    });
  });

  describe('rate limiter functions', () => {
    it('should save a rate limiter bucket', async () => {
      // Arrange
      const now = new Date();
      const bucket = {
        key: 'test-key',
        tokens: 10,
        limit: 10,
        windowMs: 60000,
        createdAt: now,
        updatedAt: now,
        lastRefill: now.getTime(),
        maxTokens: 10,
        refillTimeMs: 60000,
      };

      // Act
      const result = await adapter.saveRateLimiterBucket(bucket);

      // Assert
      expect(result).toBeTruthy();
      expect(result.key).toBe(bucket.key);
    });

    it('should get a rate limiter bucket', async () => {
      // Arrange
      const now = new Date();
      const bucket = {
        key: 'test-key',
        tokens: 10,
        limit: 10,
        windowMs: 60000,
        createdAt: now,
        updatedAt: now,
        lastRefill: now.getTime(),
        maxTokens: 10,
        refillTimeMs: 60000,
      };
      await adapter.saveRateLimiterBucket(bucket);

      // Act
      const result = await adapter.getRateLimiterBucket('test-key');

      // Assert
      expect(result).toBeTruthy();
      expect(result.tokens).toBe(10);
    });

    it('should return null when getting non-existent bucket', async () => {
      // Act
      const result = await adapter.getRateLimiterBucket('non-existent-key');

      // Assert
      expect(result).toBeNull();
    });

    it('should delete a rate limiter bucket', async () => {
      // Arrange
      const now = new Date();
      const bucket = {
        key: 'test-key',
        tokens: 10,
        limit: 10,
        windowMs: 60000,
        createdAt: now,
        updatedAt: now,
        lastRefill: now.getTime(),
        maxTokens: 10,
        refillTimeMs: 60000,
      };
      await adapter.saveRateLimiterBucket(bucket);

      // Act
      const deleted = await adapter.deleteRateLimiterBucket('test-key');
      const deletedBucket = await adapter.getRateLimiterBucket('test-key');

      // Assert
      expect(deleted).toBe(true);
      expect(deletedBucket).toBeNull();
    });
  });
});

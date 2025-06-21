import {
  ON_TASK_ACTIVE_KEY,
  ON_TASK_COMPLETED_KEY,
  ON_TASK_FAILED_KEY,
  ON_TASK_PROGRESS_KEY,
  OnTaskActive,
  OnTaskCompleted,
  OnTaskFailed,
  OnTaskProgress,
} from '../events.decorator';

describe('Events Decorators', () => {
  describe('OnQueueActive Decorator', () => {
    it('should set active event metadata on method', () => {
      // Arrange
      const mockMethodName = 'onTaskActive';

      // Create a test class with the decorated method
      class TestProcessor {
        @OnTaskActive()
        onTaskActive() {
          return 'task active';
        }
      }

      // Act
      const metadata = Reflect.getMetadata(
        ON_TASK_ACTIVE_KEY,
        TestProcessor.prototype[mockMethodName],
      );

      // Assert
      expect(metadata).toEqual({ methodName: mockMethodName });
    });
  });

  describe('OnQueueCompleted Decorator', () => {
    it('should set completed event metadata on method', () => {
      // Arrange
      const mockMethodName = 'onTaskCompleted';

      // Create a test class with the decorated method
      class TestProcessor {
        @OnTaskCompleted()
        onTaskCompleted() {
          return 'task completed';
        }
      }

      // Act
      const metadata = Reflect.getMetadata(
        ON_TASK_COMPLETED_KEY,
        TestProcessor.prototype[mockMethodName],
      );

      // Assert
      expect(metadata).toEqual({ methodName: mockMethodName });
    });
  });

  describe('OnQueueFailed Decorator', () => {
    it('should set failed event metadata on method', () => {
      // Arrange
      const mockMethodName = 'onTaskFailed';

      // Create a test class with the decorated method
      class TestProcessor {
        @OnTaskFailed()
        onTaskFailed() {
          return 'task failed';
        }
      }

      // Act
      const metadata = Reflect.getMetadata(
        ON_TASK_FAILED_KEY,
        TestProcessor.prototype[mockMethodName],
      );

      // Assert
      expect(metadata).toEqual({ methodName: mockMethodName });
    });
  });

  describe('OnQueueProgress Decorator', () => {
    it('should set progress event metadata on method', () => {
      // Arrange
      const mockMethodName = 'onTaskProgress';

      // Create a test class with the decorated method
      class TestProcessor {
        @OnTaskProgress()
        onTaskProgress() {
          return 'task progress';
        }
      }

      // Act
      const metadata = Reflect.getMetadata(
        ON_TASK_PROGRESS_KEY,
        TestProcessor.prototype[mockMethodName],
      );

      // Assert
      expect(metadata).toEqual({ methodName: mockMethodName });
    });
  });

  describe('Combined Event Decorators', () => {
    it('should support multiple event decorators in the same class', () => {
      // Arrange
      class TestProcessor {
        @OnTaskActive()
        onTaskActive() {
          return 'task active';
        }

        @OnTaskCompleted()
        onTaskCompleted() {
          return 'task completed';
        }

        @OnTaskFailed()
        onTaskFailed() {
          return 'task failed';
        }

        @OnTaskProgress()
        onTaskProgress() {
          return 'task progress';
        }
      }

      // Act & Assert
      const activeMetadata = Reflect.getMetadata(
        ON_TASK_ACTIVE_KEY,
        TestProcessor.prototype['onTaskActive'],
      );

      const completedMetadata = Reflect.getMetadata(
        ON_TASK_COMPLETED_KEY,
        TestProcessor.prototype['onTaskCompleted'],
      );

      const failedMetadata = Reflect.getMetadata(
        ON_TASK_FAILED_KEY,
        TestProcessor.prototype['onTaskFailed'],
      );

      const progressMetadata = Reflect.getMetadata(
        ON_TASK_PROGRESS_KEY,
        TestProcessor.prototype['onTaskProgress'],
      );

      expect(activeMetadata).toEqual({ methodName: 'onTaskActive' });
      expect(completedMetadata).toEqual({ methodName: 'onTaskCompleted' });
      expect(failedMetadata).toEqual({ methodName: 'onTaskFailed' });
      expect(progressMetadata).toEqual({ methodName: 'onTaskProgress' });
    });

    it('should not interfere with other method metadata', () => {
      // Arrange
      const otherMetadataKey = 'other-metadata';
      const otherMetadataValue = 'other-value';

      class TestProcessor {
        @OnTaskCompleted()
        onTaskCompleted() {
          return 'task completed';
        }
      }

      // Set other metadata on the same method
      Reflect.defineMetadata(
        otherMetadataKey,
        otherMetadataValue,
        TestProcessor.prototype,
        'onTaskCompleted',
      );

      // Act & Assert
      const completedMetadata = Reflect.getMetadata(
        ON_TASK_COMPLETED_KEY,
        TestProcessor.prototype['onTaskCompleted'],
      );

      const otherMetadata = Reflect.getMetadata(
        otherMetadataKey,
        TestProcessor.prototype,
        'onTaskCompleted',
      );

      expect(completedMetadata).toEqual({ methodName: 'onTaskCompleted' });
      expect(otherMetadata).toBe(otherMetadataValue);
    });
  });
});

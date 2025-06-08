import { Controller } from '@nestjs/common';
import {
  CLOUD_TASK_CONSUMER_KEY,
  CloudTaskConsumer,
} from '../cloud-task-consumer.decorator';

describe('CloudTaskConsumer', () => {
  it('should set queue metadata on class', () => {
    // Arrange
    const queueName = 'test-queue';

    // Create a test class with the decorator
    @CloudTaskConsumer({ queues: [queueName] })
    class TestController {}

    // Act
    const metadata = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController,
    );

    // Assert
    expect(metadata).toBeDefined();
    expect(metadata.queues).toContain(queueName);
  });

  it('should set queue metadata with options', () => {
    // Arrange
    const queueName = 'test-queue';
    const options = {
      queues: [queueName],
      includeOidcToken: false,
      path: 'custom-path',
    };

    // Create a test class with the decorator and options
    @CloudTaskConsumer(options)
    class TestController {}

    // Act
    const metadata = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController,
    );

    // Assert
    expect(metadata).toBeDefined();
    expect(metadata.queues).toContain(queueName);
    expect(metadata.includeOidcToken).toBe(false);
    expect(metadata.path).toBeUndefined(); // path is only used for Controller decorator
  });

  it('should combine with NestJS Controller decorator', () => {
    // Arrange
    const queueName = 'test-queue';
    const controllerPath = 'api/tasks';

    // Create a test class with both decorators
    @Controller(controllerPath)
    @CloudTaskConsumer({ queues: [queueName] })
    class TestController {}

    // Act
    const queueMetadata = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController,
    );
    const pathMetadata = Reflect.getMetadata('path', TestController);

    // Assert
    expect(queueMetadata).toBeDefined();
    expect(queueMetadata.queues).toContain(queueName);
    expect(pathMetadata).toBe(controllerPath);
  });

  it('should set metadata for multiple controllers', () => {
    // Arrange
    const queue1 = 'queue-1';
    const queue2 = 'queue-2';

    // Create test classes with different queue names
    @CloudTaskConsumer({ queues: [queue1] })
    class TestController1 {}

    @CloudTaskConsumer({ queues: [queue2], includeOidcToken: false })
    class TestController2 {}

    // Act
    const metadata1 = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController1,
    );
    const metadata2 = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController2,
    );

    // Assert
    expect(metadata1.queues).toContain(queue1);
    expect(metadata1.includeOidcToken).toBe(true); // default

    expect(metadata2.queues).toContain(queue2);
    expect(metadata2.includeOidcToken).toBe(false);
  });

  it('should not interfere with other class metadata', () => {
    // Arrange
    const queueName = 'test-queue';
    const otherMetadataKey = 'other-metadata';
    const otherMetadataValue = 'other-value';

    // Create a test class with the decorator and other metadata
    @CloudTaskConsumer({ queues: [queueName] })
    class TestController {}

    // Set other metadata
    Reflect.defineMetadata(
      otherMetadataKey,
      otherMetadataValue,
      TestController,
    );

    // Act
    const queueMetadata = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController,
    );
    const otherMetadata = Reflect.getMetadata(otherMetadataKey, TestController);

    // Assert
    expect(queueMetadata.queues).toContain(queueName);
    expect(otherMetadata).toBe(otherMetadataValue);
  });

  it('should support wildcard in queues array', () => {
    // Arrange
    const wildcardQueue = '*';

    // Create a test class with wildcard queue
    @CloudTaskConsumer({ queues: [wildcardQueue] })
    class TestController {}

    // Act
    const metadata = Reflect.getMetadata(
      CLOUD_TASK_CONSUMER_KEY,
      TestController,
    );

    // Assert
    expect(metadata.queues).toContain(wildcardQueue);
  });
});

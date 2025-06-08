import { Processor, PROCESSOR_QUEUE_KEY } from '../processor.decorator';

describe('Processor Decorator', () => {
  it('should set queue name metadata on class', () => {
    // Arrange
    const queueName = 'test-queue';

    // Create a test class with the decorator
    @Processor(queueName)
    class TestProcessor {}

    // Act & Assert
    const metadata = Reflect.getMetadata(PROCESSOR_QUEUE_KEY, TestProcessor);
    expect(metadata).toBe(queueName);
  });

  it('should set queue name for multiple processors', () => {
    // Arrange
    const queue1 = 'queue-1';
    const queue2 = 'queue-2';

    // Create test classes with different queue names
    @Processor(queue1)
    class TestProcessor1 {}

    @Processor(queue2)
    class TestProcessor2 {}

    // Act & Assert
    const metadata1 = Reflect.getMetadata(PROCESSOR_QUEUE_KEY, TestProcessor1);
    const metadata2 = Reflect.getMetadata(PROCESSOR_QUEUE_KEY, TestProcessor2);

    expect(metadata1).toBe(queue1);
    expect(metadata2).toBe(queue2);
  });

  it('should not interfere with other class metadata', () => {
    // Arrange
    const queueName = 'test-queue';
    const otherMetadataKey = 'other-metadata';
    const otherMetadataValue = 'other-value';

    // Create a test class with the decorator and other metadata
    @Processor(queueName)
    class TestProcessor {}

    // Set other metadata
    Reflect.defineMetadata(otherMetadataKey, otherMetadataValue, TestProcessor);

    // Act & Assert
    const processorMetadata = Reflect.getMetadata(
      PROCESSOR_QUEUE_KEY,
      TestProcessor,
    );
    const otherMetadata = Reflect.getMetadata(otherMetadataKey, TestProcessor);

    expect(processorMetadata).toBe(queueName);
    expect(otherMetadata).toBe(otherMetadataValue);
  });
});

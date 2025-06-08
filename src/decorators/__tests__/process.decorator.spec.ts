import { Process, PROCESS_METHOD_KEY } from '../process.decorator';

describe('Process Decorator', () => {
  it('should set process metadata on method', () => {
    // Arrange
    const mockMethodName = 'processTask';

    // Create a test class with the decorated method
    class TestProcessor {
      @Process()
      processTask() {
        return 'processed';
      }
    }

    // Act
    const metadata = Reflect.getMetadata(
      PROCESS_METHOD_KEY,
      TestProcessor.prototype[mockMethodName],
    );

    // Assert
    expect(metadata).toEqual({ methodName: mockMethodName });
  });

  it('should set process metadata with a specific method name', () => {
    // Arrange
    const mockMethodName = 'customProcessMethod';

    // Create a test class with a decorated method using a different name
    class TestProcessor {
      @Process()
      [mockMethodName]() {
        return 'processed';
      }
    }

    // Act
    const metadata = Reflect.getMetadata(
      PROCESS_METHOD_KEY,
      TestProcessor.prototype[mockMethodName],
    );

    // Assert
    expect(metadata).toEqual({ methodName: mockMethodName });
  });

  it('should be able to decorate multiple methods in the same class', () => {
    // Arrange
    const method1 = 'processTask1';
    const method2 = 'processTask2';

    // Create a test class with multiple decorated methods
    class TestProcessor {
      @Process()
      [method1]() {
        return 'processed 1';
      }

      @Process()
      [method2]() {
        return 'processed 2';
      }
    }

    // Act & Assert
    const metadata1 = Reflect.getMetadata(
      PROCESS_METHOD_KEY,
      TestProcessor.prototype[method1],
    );

    const metadata2 = Reflect.getMetadata(
      PROCESS_METHOD_KEY,
      TestProcessor.prototype[method2],
    );

    expect(metadata1).toEqual({ methodName: method1 });
    expect(metadata2).toEqual({ methodName: method2 });
  });

  it('should not affect non-decorated methods', () => {
    // Arrange
    const decoratedMethod = 'processTask';
    const nonDecoratedMethod = 'regularMethod';

    // Create a test class with both decorated and non-decorated methods
    class TestProcessor {
      @Process()
      [decoratedMethod]() {
        return 'processed';
      }

      [nonDecoratedMethod]() {
        return 'regular';
      }
    }

    // Act & Assert
    const decoratedMetadata = Reflect.getMetadata(
      PROCESS_METHOD_KEY,
      TestProcessor.prototype[decoratedMethod],
    );

    const nonDecoratedMetadata = Reflect.getMetadata(
      PROCESS_METHOD_KEY,
      TestProcessor.prototype[nonDecoratedMethod],
    );

    expect(decoratedMetadata).toEqual({ methodName: decoratedMethod });
    expect(nonDecoratedMetadata).toBeUndefined();
  });
});

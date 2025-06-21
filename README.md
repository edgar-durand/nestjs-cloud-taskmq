# CloudTaskMQ

CloudTaskMQ is a NestJS library that provides a queue system similar to BullMQ but leverages Google Cloud Tasks for task scheduling and delivery, with MongoDB or Redis for state tracking and observability.

## Features

- **Google Cloud Tasks Integration**: Utilize GCP's managed queue service for task scheduling and delivery
- **State Tracking**: Persistent storage of task states (idle, active, completed, failed) using MongoDB, Redis, or in-memory storage
- **Storage Agnostic**: Switch between storage providers without changing your application code
- **Task Chaining**: Sequential task execution with automatic chain progression and proper ordering
- **Rate Limiting**: Built-in persistent rate limiting to control task processing throughput
- **Automatic Queue Creation**: Optionally create missing queues in GCP Cloud Tasks
- **Task Retries**: Configure retry attempts for failed tasks with customizable backoff
- **Event-Driven Programming**: Familiar BullMQ-like decorators for lifecycle events
- **Easy Job Processing**: Simple API for adding tasks to queues and processing them
- **Observability**: Track task status and monitor queue health
- **TypeScript Support**: Built with and for TypeScript with type safety in mind
- **Task Uniqueness (`uniquenessKey`)**: Prevent duplicate task processing. Provide a `uniquenessKey` when adding a task. If a task with the same key is added while the key is "active" in the storage, the new task attempt is dropped.
    - A key becomes active when a consumer picks up a task with that key and saves it before processing.
    - The key is stored with a 24-hour Time-To-Live (TTL) as a safeguard (e.g., if a consumer crashes).
    - If the task completes and `removeOnComplete` is `true` (or `removeOnFail` is `true` for failed tasks), the `uniquenessKey` is removed from storage along with the task record, allowing a new task with the same key to be processed sooner than the full TTL.
    - If `removeOnComplete` is `false`, the `uniquenessKey` will persist for its full 24-hour TTL, enforcing uniqueness for that entire period even after task completion.

## Quick Start

### 1. Register the Module

```typescript
import { Module } from '@nestjs/common';
import { CloudTaskMQModule } from 'nestjs-cloud-taskmq';

@Module({
  imports: [
    CloudTaskMQModule.forRoot({
      projectId: 'my-gcp-project',
      location: 'us-central1',
      defaultProcessorUrl: 'https://my-app.com/api/cloud-tasks',
      queues: [
        {
          name: 'email-queue', // Name used in your code
          path: 'projects/my-gcp-project/locations/us-central1/queues/email-queue', // Full path in GCP
          serviceAccountEmail: 'my-service-account@my-gcp-project.iam.gserviceaccount.com',
        },
        {
          name: 'notification-queue',
          path: 'projects/my-gcp-project/locations/us-central1/queues/notification-queue',
        }
      ],
      storageAdapter: 'mongo', // 'redis', 'memory', or 'custom'
      storageOptions: {
        mongoUri: 'mongodb://localhost:27017/my-app',
        collectionName: 'cloud_tasks', // optional, defaults to 'cloud_taskmq_tasks'
      },
    }),
  ],
})
export class AppModule {}
```

### Using Redis Storage

```typescript
CloudTaskMQModule.forRoot({
  // other config...
  storageAdapter: 'redis',
  storageOptions: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: 'password', // Optional
      // OR use a connection URL
      url: 'redis://:password@localhost:6379',
      keyPrefix: 'cloud-taskmq:', // Optional, defaults to 'cloud-taskmq:'
    },
  },
  // other config...
})
```

### Using In-Memory Storage (for development/testing)

```typescript
CloudTaskMQModule.forRoot({
  // other config...
  storageAdapter: 'memory',
  // other config...
})
```

### 2. Using Environment Variables (Recommended)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CloudTaskMQModule } from 'nestjs-cloud-taskmq';

@Module({
  imports: [
    ConfigModule.forRoot(),
    CloudTaskMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        projectId: configService.get('GCP_PROJECT_ID'),
        location: configService.get('GCP_LOCATION'),
        defaultProcessorUrl: configService.get('CLOUD_TASKS_PROCESSOR_URL'),
        queues: [
          {
            name: 'email-queue',
            path: `projects/${configService.get('GCP_PROJECT_ID')}/locations/${configService.get('GCP_LOCATION')}/queues/email-queue`,
            serviceAccountEmail: configService.get('GCP_SERVICE_ACCOUNT'),
          },
        ],
        storageAdapter: configService.get('STORAGE_ADAPTER') || 'mongo',
        storageOptions: {
          mongoUri: configService.get('MONGODB_URI'),
          // For Redis:
          // redis: {
          //   host: configService.get('REDIS_HOST'),
          //   port: configService.get('REDIS_PORT'),
          //   password: configService.get('REDIS_PASSWORD'),
          // },
        },
      }),
    }),
  ],
})
export class AppModule {}
```

## Task Producer: Adding Tasks to Queues

## Adding Tasks to Queues

```typescript
import { Injectable } from '@nestjs/common';
import { ProducerService } from 'nestjs-cloud-taskmq';

@Injectable()
export class EmailService {
  constructor(private readonly producerService: ProducerService) {}

  async sendWelcomeEmail(userId: string, email: string): Promise<void> {
    // Add a task to the email-queue
    await this.producerService.addTask('email-queue', {
      to: email,
      subject: 'Welcome!',
      template: 'welcome',
      userId,
    }, {
      // Optional parameters
      scheduleTime: new Date(Date.now() + 60000), // Run 1 minute from now
      taskId: `welcome-${userId}`, // Custom task ID (must be unique)
      uniquenessKey: `welcome-email-${userId}`, // Ensures this task is unique for this userId while key is active
      metadata: { importance: 'high' }, // Custom metadata
      maxRetry: 3, // Maximum number of retry attempts
      rateLimiterKey: 'welcome-emails', // Custom rate limiter key
      removeOnComplete: true, // Remove task from storage when completed
      removeOnFail: false, // Keep failed tasks in storage
    });
  }

  // Schedule a task with a custom ID that includes timestamp to avoid duplicates when retrying
  async sendDailyDigest(userId: string, email: string): Promise<void> {
    const timestamp = Date.now();
    await this.producerService.addTask('email-queue', {
      to: email,
      subject: 'Your Daily Digest',
      template: 'daily-digest',
      userId,
    }, {
      taskId: `daily-digest-${userId}-${timestamp}`,
    });
  }
}

### Using `uniquenessKey` for Idempotent Task Submission

The `uniquenessKey` option allows you to ensure that a task is processed only once, even if it's submitted multiple times with the same key. This is useful for operations that should be idempotent based on certain parameters.

**How it works:**
- When you provide a `uniquenessKey` (e.g., `order-confirmation-${orderId}`) in the `AddTaskOptions`:
  1.  The `ProducerService` checks if this key is already active in the storage. If so, the new task submission is dropped.
  2.  If the key is not active, the task is created, and the `uniquenessKey` is passed in its metadata.
  3.  When a `ConsumerService` instance picks up the task, it again checks the `uniquenessKey`:
      - If the key is already active in storage (e.g., another consumer processed it, or it's a retry after the key was saved), the task is skipped.
      - Otherwise, the consumer saves the `uniquenessKey` to storage *before* processing the task. This key is automatically set with a 24-hour Time-To-Live (TTL) by the storage adapter (Redis, Mongo, Memory) as a safeguard.
- **Interaction with `removeOnComplete` / `removeOnFail`**:
  - If `removeOnComplete: true` (default for `addTask` if not specified in options or task configuration) and the task completes successfully, the `uniquenessKey` is removed from storage along with the task record. This means a new task with the same `uniquenessKey` can be processed relatively soon after the first one completes.
  - If `removeOnComplete: false`, the `uniquenessKey` will remain in storage for its full 24-hour TTL, even after the task finishes. This enforces uniqueness for that key for the entire 24-hour period.
  - Similar logic applies with `removeOnFail` for failed tasks.

**Example:**

```typescript
import { Injectable } from '@nestjs/common';
import { ProducerService } from 'nestjs-cloud-taskmq';

@Injectable()
export class OrderService {
  constructor(private readonly producerService: ProducerService) {}

  async processOrderPayment(orderId: string, paymentDetails: any): Promise<void> {
    // This task will only be processed once per orderId while the key is active.
    // If this method is called multiple times for the same orderId quickly,
    // subsequent attempts will be dropped.
    await this.producerService.addTask('payment-processing-queue', 
      { orderId, ...paymentDetails }, 
      {
        uniquenessKey: `payment-${orderId}`,
        // To ensure uniqueness for the full 24-hour TTL, even if this task completes quickly:
        // removeOnComplete: false, 
        // By default (or if removeOnComplete: true), the uniquenessKey is cleared on successful completion.
      }
    );
  }
}
```

## Task Consumer: Processing Tasks

### Creating a Processor

```typescript
import { Injectable } from '@nestjs/common';
import { 
  Processor, 
  Process, 
  OnQueueActive, 
  OnQueueCompleted, 
  OnQueueFailed,
  CloudTask
} from 'nestjs-cloud-taskmq';

// Define the type of your task payload for better type safety
interface EmailTaskPayload {
  type: string;
  userId: string;
  email: string;
  subject: string;
  body?: string;
}

@Injectable()
@Processor('email-queue')
export class EmailProcessor {
    constructor(private readonly actualEmailService: YourEmailService) {}
    
    @Process()
    async handleEmailTask(task: CloudTask<EmailTaskPayload>): Promise<any> {
    const { type, userId, email, subject, body } = task.payload;
    
    // Report progress (if you have an @OnQueueProgress handler)
    await task.reportProgress(50);
    
    // Send the actual email
    await this.actualEmailService.sendEmail(email, subject, body);
    
    // Return a result (will be passed to @OnQueueCompleted handler)
    return { success: true, sentAt: new Date() };
    }
    
    @OnTaskActive()
    onActive(task: CloudTask<EmailTaskPayload>): void {
    console.log(`Processing email task ${task.taskId} for user ${task.payload.userId}`);
    }
    
    @OnTaskCompleted()
    onCompleted(task: CloudTask<EmailTaskPayload>, result: any): void {
    console.log(`Email task ${task.taskId} completed with result:`, result);
    }
    
    @OnTaskFailed()
    onFailed(task: CloudTask<EmailTaskPayload>, error: Error): void {
    console.error(`Email task ${task.taskId} failed with error:`, error.message);
    // You might want to notify someone or log to a monitoring system
    }

    /**
     * Called when progress is reported
     */
    @OnTaskProgress()
    onTaskProgress(task: CloudTask<TestTaskPayload>, progress: number): void {
        console.log(`Task ${task.taskId} progress: ${progress}%`);
    }
}

### Setting up the consumer endpoint

By default, CloudTaskMQ creates a controller at `/cloud-tasks` to handle incoming task requests from Google Cloud Tasks. However, you can create your own custom controller:

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { CloudTaskConsumer } from 'nestjs-cloud-taskmq';

@CloudTaskConsumer({
  queues: ['email-queue', 'notification-queue'],
  includeOidcToken: true, // If you are using a different auth mechanism or no auth (e.g., internal network),
  // you might need to adjust or provide custom guards.
  // For Cloud Tasks with OIDC:
  // Controller expects OIDC tokens from GCP for authentication.
})
export class TasksController {
  // The CloudTaskMQ library will handle most of the work for you,
  // but you can add your own logic here if needed
  @Post()
  async handleTask(@Body() body: any): Promise<any> {
    // Additional custom logic can go here
    console.log('Received task:', body.taskId);
    
    // The actual task processing is handled automatically by the library
    return { received: true };
  }
}

## Storage Adapters

CloudTaskMQ supports different storage adapters for storing task state. By default, it includes adapters for MongoDB, Redis, and InMemory.

### MongoDB Adapter

```typescript
CloudTaskMQModule.forRoot({
  // ... other configuration
  storageAdapter: 'mongo',
  storageOptions: {
    mongoUri: 'mongodb://localhost:27017/my-database',
    collectionName: 'cloud_tasks', // Optional, defaults to 'cloud_taskmq_tasks'
  },
})
```

### Redis Adapter

```typescript
CloudTaskMQModule.forRoot({
  // ... other configuration
  storageAdapter: 'redis',
  storageOptions: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: 'password', // Optional
      keyPrefix: 'my-app:', // Optional prefix for Redis keys
    },
  },
})
```

## Advanced: Custom Storage Adapter

You can implement your own storage adapter by implementing the `IStateStorageAdapter` interface:

```typescript
import { Injectable } from '@nestjs/common';
import { IStateStorageAdapter, TaskQueryOptions, ITask, TaskStatus, IRateLimiterBucket } from 'nestjs-cloud-taskmq';

@Injectable()
export class CustomStorageAdapter implements IStateStorageAdapter {
  async initialize(): Promise<void> {
    // Initialize connection to your storage, e.g., DB connection, create tables/collections if not exist
    console.log('CustomStorageAdapter initialized');
  }

  async createTask(task: Omit<ITask, 'createdAt' | 'updatedAt'>): Promise<ITask> {
    // Logic to save the task to your custom storage
    // Ensure to return the full task object including generated createdAt and updatedAt
    const newTask = { ...task, createdAt: new Date(), updatedAt: new Date(), id: 'custom-id' } as ITask; // Example
    console.log('Task created:', newTask.taskId);
    return newTask;
  }

  async getTaskById(taskId: string): Promise<ITask | null> {
    // Logic to retrieve a task by its ID from your storage
    console.log('Getting task by ID:', taskId);
    return null; // Replace with actual implementation
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, additionalData?: Partial<ITask>): Promise<ITask | null> {
    // Logic to update the status and other data of a task
    console.log('Updating task status:', taskId, status);
    return null; // Replace with actual implementation
  }

  async acquireTaskLock(taskId: string, workerId: string, lockDurationMs: number): Promise<boolean> {
    // Logic to attempt to lock a task for processing
    // Return true if lock acquired, false otherwise
    console.log('Acquiring task lock:', taskId, workerId, lockDurationMs);
    return true; // Replace with actual implementation
  }

  async releaseTaskLock(taskId: string, workerId: string): Promise<boolean> {
    // Logic to release a lock on a task
    // Return true if lock released, false otherwise (e.g., if not locked by this worker)
    console.log('Releasing task lock:', taskId, workerId);
    return true; // Replace with actual implementation
  }

  async findTasks(options: TaskQueryOptions): Promise<ITask[]> {
    // Logic to find tasks based on query options (status, queueName, pagination, sorting)
    console.log('Finding tasks with options:', options);
    return []; // Replace with actual implementation
  }

  async countTasks(options: TaskQueryOptions): Promise<number> {
    // Logic to count tasks based on query options
    console.log('Counting tasks with options:', options);
    return 0; // Replace with actual implementation
  }

  async deleteTask(taskId: string): Promise<boolean> {
    // Logic to delete a task by its ID
    // Return true if deleted, false otherwise
    console.log('Deleting task:', taskId);
    return true; // Replace with actual implementation
  }

  async completeTask(taskId: string, result?: any): Promise<ITask> {
    // Logic to mark a task as completed, store result, and update status
    console.log('Completing task:', taskId, result);
    // Should typically call updateTaskStatus internally or similar logic
    return null; // Replace with actual implementation that returns the updated task
  }

  async failTask(taskId: string, error?: any): Promise<ITask> {
    // Logic to mark a task as failed, store error, and update status
    console.log('Failing task:', taskId, error);
    // Should typically call updateTaskStatus internally or similar logic
    return null; // Replace with actual implementation that returns the updated task
  }

  // Rate limiter methods
  async getRateLimiterBucket(key: string): Promise<IRateLimiterBucket | null> {
    // Logic to retrieve a rate limiter bucket by its key
    console.log('Getting rate limiter bucket:', key);
    return null; // Replace with actual implementation
  }

  async saveRateLimiterBucket(bucket: IRateLimiterBucket): Promise<IRateLimiterBucket> {
    // Logic to save a rate limiter bucket
    console.log('Saving rate limiter bucket:', bucket.key);
    return bucket; // Replace with actual implementation that returns the saved/updated bucket
  }

  async deleteRateLimiterBucket(key: string): Promise<boolean> {
    // Logic to delete a rate limiter bucket by its key
    // Return true if deleted, false otherwise
    console.log('Deleting rate limiter bucket:', key);
    return true; // Replace with actual implementation
  }

  // Uniqueness key methods
  async getUniquenessValue(key: string): Promise<boolean> {
    // Logic to check if a uniqueness key exists (and is active)
    // Return true if key exists, false otherwise
    console.log('Getting uniqueness value for key:', key);
    return false; // Replace with actual implementation
  }

  async saveUniquenessKey(key: string): Promise<void> {
    // Logic to save a uniqueness key (typically with a TTL, e.g., 24 hours)
    console.log('Saving uniqueness key:', key);
  }

  async removeUniquenessKey(key: string): Promise<void> {
    // Logic to remove a uniqueness key
    console.log('Removing uniqueness key:', key);
  }

  async hasActiveTaskInChain(chainId: string): Promise<boolean> {
    // Logic to check if there are any active tasks in the specified chain
    // Return true if there are active tasks, false otherwise
    console.log('Checking for active tasks in chain:', chainId);
    return false; // Replace with actual implementation
  }

  async getNextTaskInChain(chainId: string): Promise<ITask | null> {
    // Logic to get the next task to be executed in the chain
    // Should return the IDLE task with the lowest chainOrder in the specified chain
    console.log('Getting next task in chain:', chainId);
    return null; // Replace with actual implementation
  }

  async findTasksByChainId(chainId: string, status?: TaskStatus): Promise<ITask[]> {
    // Logic to find all tasks in a chain, optionally filtered by status
    // Used for chain management and monitoring
    console.log('Finding tasks by chain ID:', chainId, 'with status:', status);
    return []; // Replace with actual implementation
  }
}

### Integrating Your Custom Storage Adapter

Once you have defined your `CustomStorageAdapter` class (as shown above), you need to register an instance of it with the `CloudTaskMQModule`. This is done by setting the `storageAdapter` option to `'custom'` and providing your adapter instance to the `customStorageAdapterInstance` property in the module configuration.

The `CloudTaskMQModule` will automatically call the `initialize()` method on your provided `customStorageAdapterInstance` during its bootstrap process.

**1. Basic Integration (Simple Instantiation)**

If your `CustomStorageAdapter` does not have complex dependencies and can be instantiated directly:

```typescript
// src/app.module.ts (or your main application module)

import { Module } from '@nestjs/common';
import { CloudTaskMQModule } from 'nestjs-cloud-taskmq'; // Adjust path as needed
import { CustomStorageAdapter } from './your-path-to-adapter/custom-storage.adapter'; // Adjust path

@Module({
  imports: [
    // ... other NestJS modules (e.g., ConfigModule)
    CloudTaskMQModule.forRoot({
      // --- Essential Cloud Task MQ Configuration ---
      projectId: 'your-gcp-project-id', // Replace with your GCP Project ID
      location: 'your-gcp-location',   // Replace with your GCP Location (e.g., 'us-central1')
      defaultProcessorUrl: 'https://your-app-url.com/tasks/process', // Optional: Default base URL for task handlers

      queues: [
        {
          name: 'email-queue', // Name used in your code
          path: 'projects/your-gcp-project-id/locations/your-gcp-location/queues/email-queue', // Full path in GCP
          // processorUrl: 'https://your-app-url.com/tasks/email', // Optional: Specific URL for this queue
        },
        // ... add more queue configurations
      ],

      // --- Custom Storage Adapter Configuration ---
      storageAdapter: 'custom',
      customStorageAdapterInstance: new CustomStorageAdapter(/* Pass constructor arguments if any */),

      // --- Optional Global Settings ---
      // lockDurationMs: 300000, // Optional: Default 5 minutes
      // autoCreateQueues: false, // Optional: Default false
    }),
  ],
  // ... controllers, providers for your application
})
export class AppModule {}
```

**2. Advanced Integration (Using NestJS DI for Custom Adapter)**

If your `CustomStorageAdapter` has its own dependencies that need to be injected by NestJS (e.g., a database connection service), you should make your `CustomStorageAdapter` a NestJS provider. Then, use `CloudTaskMQModule.forRootAsync` to retrieve the adapter instance from the DI container.

First, ensure your `CustomStorageAdapter` is an injectable provider, possibly within its own module:

Then, integrate it using `CloudTaskMQModule.forRootAsync`:

```typescript
// src/app.module.ts (or your main application module)

import { Module } from '@nestjs/common';
import { CloudTaskMQModule } from 'nestjs-cloud-taskmq';
import { CustomStorageAdapter } from './custom-storage/custom-storage.adapter';
// import { ConfigModule, ConfigService } from '@nestjs/config'; // Example for config-based setup

@Module({
  imports: [
    // ConfigModule.forRoot({ isGlobal: true }), // Example
    CloudTaskMQModule.forRootAsync({
      imports: [CustomStorageModule /*, ConfigModule */], // Make CustomStorageAdapter and other services like ConfigService available
      useFactory: async (customAdapter: CustomStorageAdapter /*, configService: ConfigService */) => {
        // The customAdapter instance is managed by NestJS DI.
        // Its initialize() method will be called by CloudTaskMQModule.
        return {
          // projectId: configService.get('GCP_PROJECT_ID'), // Example: from ConfigService
          // location: configService.get('GCP_LOCATION'),     // Example: from ConfigService
          projectId: 'your-gcp-project-id',
          location: 'your-gcp-location',
          queues: [/* queue config */],

          storageAdapter: 'custom',
          customStorageAdapterInstance: customAdapter,

          // ... other global configurations
        };
      },
      inject: [CustomStorageAdapter /*, ConfigService */], // Inject your custom adapter and other dependencies for the factory
    }),
  ],
  providers: [CustomStorageAdapter /*, ConfigService */], // Make CustomStorageAdapter and other services like ConfigService available
})
export class AppModule {}
```

Remember to replace placeholder values like `'your-gcp-project-id'`, paths, and service names with your actual configuration.

## Rate Limiting

CloudTaskMQ provides persistent rate limiting for controlling task processing throughput. Rate limits persist across application restarts using the configured storage adapter.

### 1. Queue-Level Rate Limiting

Define rate limiters in the queue configuration:

```typescript
CloudTaskMQModule.forRoot({
  // other config...
  queues: [
    {
      name: 'email-queue',
      path: 'projects/my-gcp-project/locations/us-central1/queues/email-queue',
      rateLimiterOptions: [
        {
          limiterKey: 'email-queue-default', // Default limiter for this queue
          tokens: 100, // Allow 100 operations
          timeMS: 60000, // Per minute (60000ms)
        }
      ],
    },
  ],
})
```

### 2. Dynamic Rate Limiters

Create and use rate limiters at runtime:

```typescript
import { Injectable } from '@nestjs/common';
import { RateLimiterService, ProducerService } from 'nestjs-cloud-taskmq';

@Injectable()
export class NotificationService {
  constructor(
    private readonly producerService: ProducerService,
    private readonly rateLimiterService: RateLimiterService
  ) {
    // Set up rate limiters during service initialization
    this.setupRateLimiters();
  }

  private async setupRateLimiters() {
    // Register a rate limiter for a specific user
    await this.rateLimiterService.registerDynamicLimiter({
      limiterKey: 'user-123-notifications',
      tokens: 10, // Allow 10 notifications
      timeMS: 3600000, // Per hour (3600000ms)
    });
  }

  async sendNotification(userId: string, message: string) {
    // Use the rate limiter when adding a task
    await this.producerService.addTask('notification-queue', {
      userId,
      message,
    }, {
      rateLimiterKey: `user-${userId}-notifications`,
    });
  }

  async cleanup(userId: string) {
    // Remove a dynamic rate limiter when no longer needed
    await this.rateLimiterService.unregisterDynamicLimiter(`user-${userId}-notifications`);
  }
}
```

## Task Retries

Configure automatic retries for failed tasks:

```typescript
// When adding a task
await producerService.addTask('some-queue', payload, {
  maxRetry: 5, // Retry up to 5 times
});

// Or in the processor
@CloudTaskProcessor({
  queue: 'some-queue',
  maxRetry: 3, // Default max retries for all tasks in this processor
})
export class SomeProcessor {
}
```

## Queue Auto-Creation

Enable automatic creation of queues that don't exist in GCP:

```typescript
CloudTaskMQModule.forRoot({
  // other config...
  autoCreateQueues: true, // Will create any queues that don't exist in GCP
  queues: [/* queue config */],
})
```

## Task Chaining

CloudTaskMQ supports sequential task execution through the task chaining feature. Tasks in a chain are executed one at a time in the specified order, ensuring proper sequence and data flow between related tasks.

### Basic Chaining

To create a chain of tasks, use the `chainOptions` parameter when adding tasks:

```typescript
import { ProducerService } from 'nestjs-cloud-taskmq';

@Injectable()
export class OrderService {
  constructor(private readonly producerService: ProducerService) {}

  async processOrderWorkflow(orderId: string): Promise<void> {
    const chainId = `order-${orderId}`;

    // Step 1: Validate payment
    await this.producerService.addTask('payment-queue', 
      { orderId, action: 'validate' },
      { chainOptions: { chainId, chainOrder: 1 } }
    );

    // Step 2: Process inventory
    await this.producerService.addTask('inventory-queue',
      { orderId, action: 'reserve' },
      { chainOptions: { chainId, chainOrder: 2 } }
    );

    // Step 3: Send confirmation email
    await this.producerService.addTask('email-queue',
      { orderId, action: 'send-confirmation' },
      { chainOptions: { chainId, chainOrder: 3 } }
    );
  }
}
```

### Chain Execution Flow

1. **Task Creation**: All chain tasks start with `IDLE` status regardless of chain state
2. **Polling Discovery**: The polling mechanism discovers `IDLE` tasks and filters them for chain eligibility
3. **Chain Filtering**: Only one task per chain can be `ACTIVE` at a time; the system selects the next task based on `chainOrder`
4. **Task Execution**: The selected task is sent to GCP Cloud Tasks and marked as `ACTIVE`
5. **Chain Progression**: When a task completes or fails, the next task in the chain is automatically activated

### Chain Management

You can monitor and manage chains using the producer service:

```typescript
@Injectable()
export class OrderService {
  constructor(private readonly producerService: ProducerService) {}

  async getChainStatus(chainId: string): Promise<ITask[]> {
    // Get all tasks in a chain
    return await this.producerService.getChainTasks(chainId);
  }

  async getActiveChainTasks(chainId: string): Promise<ITask[]> {
    // Get only active tasks in a chain
    return await this.producerService.getChainTasks(chainId, TaskStatus.ACTIVE);
  }
}
```

### Chain Task Processing

Chain tasks are processed the same way as regular tasks. The chaining logic is handled automatically:

```typescript
@Consumer('payment-queue')
export class PaymentProcessor {
  @Process()
  async processPayment(task: CloudTask<{ orderId: string; action: string }>): Promise<any> {
    const { orderId, action } = task.data;
    
    if (action === 'validate') {
      // Validate payment logic
      const isValid = await this.validatePayment(orderId);
      
      if (!isValid) {
        throw new Error('Payment validation failed');
      }
      
      return { status: 'validated', orderId };
    }
  }

  @OnTaskCompleted()
  onCompleted(task: CloudTask, result: any): void {
    console.log(`Payment task completed for order ${task.data.orderId}`);
    // Next task in chain will be automatically activated
  }

  @OnTaskFailed()
  onFailed(task: CloudTask, error: Error): void {
    console.log(`Payment task failed for order ${task.data.orderId}:`, error.message);
    // Next task in chain will still be activated
  }
}
```

### Chain Behavior with Rate Limiting

When a chain task is rate-limited, it gets special handling:

- **Rate-limited chain tasks** with `scheduleTime` are sent directly to GCP, bypassing normal chain ordering
- This ensures rate-limited retries work correctly without getting stuck
- A warning is logged when `chainOptions` and `scheduleTime` are combined

⚠️ **Important**: Combining `chainOptions` with `scheduleTime` breaks the sequential execution guarantee and should only be used for rate-limited retries.

### Best Practices

1. **Unique Chain IDs**: Use meaningful, unique identifiers for chains (e.g., `order-${orderId}`, `user-onboarding-${userId}`)

2. **Sequential Order Numbers**: Use incremental integers for `chainOrder` (1, 2, 3, etc.)

3. **Error Handling**: Design your chain to handle failures gracefully:
   ```typescript
   @OnTaskFailed()
   onFailed(task: CloudTask, error: Error): void {
     if (task.chainId) {
       // Log chain failure
       console.log(`Chain ${task.chainId} failed at step ${task.chainOrder}`);
       
       // Next task will still be processed - implement your retry logic
       if (this.shouldRetryChain(error)) {
         // Custom retry logic
       }
     }
   }
   ```

4. **Chain Monitoring**: Implement monitoring for long-running chains:
   ```typescript
   async monitorChainProgress(chainId: string): Promise<void> {
     const tasks = await this.producerService.getChainTasks(chainId);
     const completed = tasks.filter(t => t.status === TaskStatus.COMPLETED).length;
     const total = tasks.length;
     
     console.log(`Chain ${chainId} progress: ${completed}/${total}`);
   }
   ```

### Error Handling

CloudTaskMQ integrates with Cloud Tasks' retry mechanism. When a task throws an error:

1. The task is marked as FAILED in the storage
2. The @OnTaskFailed handler is called (if defined)
3. The error is logged
4. Cloud Tasks will handle retries according to your queue's retry configuration

```typescript
@Process()
async processTask(task: CloudTask): Promise<any> {
  try {
    // Your processing logic
    return result;
  } catch (error) {
    // You can add custom error handling here
    console.error('Custom error handling:', error);
    
    // Then rethrow to let CloudTaskMQ handle the failure
    throw error;
  }
}
```

## Google Cloud Tasks Setup

To use this library, you need to:

1. Create a Google Cloud project
2. Enable the Cloud Tasks API
3. Create queues in the GCP console or via gcloud
4. Configure a service account with appropriate permissions
5. Ensure your application has network connectivity to your storage (MongoDB/Redis)

Example gcloud command to create a queue:

```bash
gcloud tasks queues create email-queue \
  --location=us-central1 \
  --max-concurrent-dispatches=10 \
  --max-attempts=5 \
  --min-backoff=5s
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Configuration Reference

### CloudTaskMQConfig

| Property | Type | Description |
|----------|------|-------------|
| projectId | string | GCP project ID |
| location | string | GCP location (e.g., 'us-central1') |
| defaultProcessorUrl | string | URL where Cloud Tasks will send task requests |
| queues | QueueConfig[] | Array of queue configurations |
| storageAdapter | string | Storage adapter to use ('mongo' or 'redis') |
| storageOptions | object | Options specific to the chosen storage adapter |
| lockDurationMs | number | How long to lock tasks when processing (default: 60000ms) |

### QueueConfig

| Property | Type | Description |
|----------|------|-------------|
| name | string | Name of the queue (used in code references) |
| path | string | Full path to the queue in GCP |
| serviceAccountEmail | string | Service account email for OIDC token generation |
| processorUrl | string | Optional custom URL for this specific queue |

### Environment Variables

CloudTaskMQ supports several environment variables for advanced configuration:

| Variable | Description | Default | Use Case |
|----------|-------------|---------|----------|
| `CTMQ_IS_CHILD_INSTANCE` | Set to `'true'` to disable task polling/pulling in microservice instances | `false` | Useful in monorepos with microservice architecture where you want to prevent specific services from pulling tasks to avoid duplicity |

#### CTMQ_IS_CHILD_INSTANCE Usage

In monorepo architectures with multiple microservices, you might want to designate certain instances as "child" instances that don't pull tasks from the queue to avoid duplicate processing:

```typescript
// In your microservice that should NOT pull tasks
process.env.CTMQ_IS_CHILD_INSTANCE = 'true';

// Or set it in your deployment environment
// Docker: ENV CTMQ_IS_CHILD_INSTANCE=true
// Kubernetes: - name: CTMQ_IS_CHILD_INSTANCE value: "true"
```

**Example Scenario:**
- **Gateway Service**: Processes all tasks (`CTMQ_IS_CHILD_INSTANCE=false` or not set)
- **Auth Service**: Only produces tasks, doesn't process them (`CTMQ_IS_CHILD_INSTANCE=true`)  
- **Notification Service**: Only produces tasks, doesn't process them (`CTMQ_IS_CHILD_INSTANCE=true`)

This prevents multiple services from competing for the same tasks and ensures centralized task processing.

## Advanced Usage

### Task Progress Tracking

```typescript
@Processor('video-queue')
export class VideoProcessor {
  @Process()
  async processVideo(task: CloudTask<VideoTaskData>): Promise<any> {
    // Report progress at various stages
    await task.reportProgress(10); // Starting
    
    // Process video...
    await task.reportProgress(50); // Half-way
    
    // Finish processing...
    await task.reportProgress(100); // Complete
    
    return { videoUrl: 'https://example.com/processed-video.mp4' };
  }
  
  @OnTaskProgress()
  onProgress(task: CloudTask, progress: number): void {
    console.log(`Video task ${task.taskId} is ${progress}% complete`);
    // You could update a real-time dashboard here
  }
}
```

### Error Handling

CloudTaskMQ integrates with Cloud Tasks' retry mechanism. When a task throws an error:

1. The task is marked as FAILED in the storage
2. The @OnTaskFailed handler is called (if defined)
3. The error is logged
4. Cloud Tasks will handle retries according to your queue's retry configuration

```typescript
@Process()
async processTask(task: CloudTask): Promise<any> {
  try {
    // Your processing logic
    return result;
  } catch (error) {
    // You can add custom error handling here
    console.error('Custom error handling:', error);
    
    // Then rethrow to let CloudTaskMQ handle the failure
    throw error;
  }
}

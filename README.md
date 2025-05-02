# CloudTaskMQ

CloudTaskMQ is a NestJS library that provides a queue system similar to BullMQ but leverages Google Cloud Tasks for task scheduling and delivery, with MongoDB or Redis for state tracking and observability.

## Features

- **Google Cloud Tasks Integration**: Utilize GCP's managed queue service for task scheduling and delivery
- **State Tracking**: Persistent storage of task states (idle, active, completed, failed) using MongoDB, Redis, or in-memory storage
- **Storage Agnostic**: Switch between storage providers without changing your application code
- **Rate Limiting**: Built-in persistent rate limiting to control task processing throughput
- **Automatic Queue Creation**: Optionally create missing queues in GCP Cloud Tasks
- **Task Retries**: Configure retry attempts for failed tasks with customizable backoff
- **Event-Driven Programming**: Familiar BullMQ-like decorators for lifecycle events
- **Easy Job Processing**: Simple API for adding tasks to queues and processing them
- **Observability**: Track task status and monitor queue health
- **TypeScript Support**: Built with and for TypeScript with type safety in mind


## Installation

```bash
npm install nestjs-cloud-taskmq
```

For MongoDB storage adapter (default):
```bash
npm install mongoose
```

For Redis storage adapter (optional):
```bash
npm install ioredis
```

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
      storageAdapter: 'mongo', // or 'redis'
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

### 2. Using Environment Configuration (Async)

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
        defaultProcessorUrl: configService.get('PROCESSOR_URL'),
        storageAdapter: configService.get('STORAGE_ADAPTER', 'mongo'),
        storageOptions: {
          mongoUri: configService.get('MONGODB_URI'),
          collectionName: configService.get('COLLECTION_NAME', 'cloud_taskmq_tasks'),
        },
        autoCreateQueues: configService.get('AUTO_CREATE_QUEUES') === 'true',
        queues: [
          {
            name: 'email-queue',
            path: `projects/${configService.get('GCP_PROJECT_ID')}/locations/${configService.get('GCP_LOCATION')}/queues/email-queue`,
            serviceAccountEmail: configService.get('SERVICE_ACCOUNT_EMAIL'),
          },
        ],
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

  async sendWelcomeEmail(userId: string, email: string): Promise {
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
      metadata: { importance: 'high' }, // Custom metadata
      maxRetry: 3, // Maximum number of retry attempts
      rateLimiterKey: 'welcome-emails', // Custom rate limiter key
      removeOnComplete: true, // Remove task from storage when completed
      removeOnFail: false, // Keep failed tasks in storage
    });
  }

  // Schedule a task with a custom ID that includes timestamp to avoid duplicates when retrying
  async sendDailyDigest(userId: string, email: string): Promise {
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
    
    @OnQueueActive()
    onActive(task: CloudTask<EmailTaskPayload>): void {
    console.log(`Processing email task ${task.taskId} for user ${task.payload.userId}`);
    }
    
    @OnQueueCompleted()
    onCompleted(task: CloudTask<EmailTaskPayload>, result: any): void {
    console.log(`Email task ${task.taskId} completed with result:`, result);
    }
    
    @OnQueueFailed()
    onFailed(task: CloudTask<EmailTaskPayload>, error: Error): void {
    console.error(`Email task ${task.taskId} failed with error:`, error.message);
    // You might want to notify someone or log to a monitoring system
    }

    /**
     * Called when progress is reported
     */
    @OnQueueProgress()
    onTaskProgress(task: CloudTask<TestTaskPayload>, progress: number): void {
        console.log(`Task ${task.taskId} progress: ${progress}%`);
    }
}
```

### Setting up the consumer endpoint

By default, CloudTaskMQ creates a controller at `/cloud-tasks` to handle incoming task requests from Google Cloud Tasks. However, you can create your own custom controller:

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { CloudTaskConsumer } from 'nestjs-cloud-taskmq';

@CloudTaskConsumer({
  queues: ['email-queue', 'notification-queue'],
  validateOidcToken: true, // Validates OIDC tokens from GCP
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
```

## Storage Adapters

CloudTaskMQ supports different storage adapters for storing task state. By default, it includes adapters for MongoDB and Redis.

### MongoDB Adapter

```typescript
CloudTaskMQModule.forRoot({
  // ... other configuration
  storageAdapter: 'mongo',
  storageOptions: {
    mongoUri: 'mongodb://localhost:27017/my-database',
    collectionName: 'cloud_tasks', // Optional, defaults to 'cloud_taskmq_tasks'
  },
}),
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
  // Implement all required methods
  async initialize(): Promise {
    // Initialize connection to your storage
  }

  async createTask(task: Omit): Promise {
    // Create task in your storage
  }

  async getTaskById(taskId: string): Promise {
    // Retrieve task from your storage
  }

  // ... other methods from the interface

  // Rate limiter bucket methods
  async getRateLimiterBucket(key: string): Promise {
    // Get rate limiter bucket from your storage
  }

  async saveRateLimiterBucket(bucket: IRateLimiterBucket): Promise {
    // Save rate limiter bucket to your storage
  }

  async deleteRateLimiterBucket(key: string): Promise {
    // Delete rate limiter bucket from your storage
  }
}
```

Then register your custom adapter:

```typescript
import { Module } from '@nestjs/common';
import { CloudTaskMQModule, CLOUD_TASKMQ_STORAGE_ADAPTER } from 'nestjs-cloud-taskmq';
import { CustomStorageAdapter } from './custom-storage.adapter';

@Module({
  imports: [
    CloudTaskMQModule.forRootAsync({
      useFactory: () => ({
        // ... your config
        storageAdapter: 'custom', // This can be any string
      }),
      providers: [
        {
          provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
          useClass: CustomStorageAdapter,
        },
      ],
    }),
  ],
})
export class AppModule {}
```

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
  
  @OnQueueProgress()
  onProgress(task: CloudTask, progress: number): void {
    console.log(`Video task ${task.taskId} is ${progress}% complete`);
    // You could update a real-time dashboard here
  }
}
```

### Error Handling

CloudTaskMQ integrates with Cloud Tasks' retry mechanism. When a task throws an error:

1. The task is marked as FAILED in the storage
2. The @OnQueueFailed handler is called (if defined)
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

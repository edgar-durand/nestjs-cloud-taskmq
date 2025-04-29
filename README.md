# CloudTaskMQ

CloudTaskMQ is a NestJS library that provides a queue system similar to BullMQ but leverages Google Cloud Tasks for task scheduling and delivery, with MongoDB or Redis for state tracking and observability.

## Features

- **Google Cloud Tasks Integration**: Utilize GCP's managed queue service for task scheduling and delivery
- **State Tracking**: Persistent storage of task states (idle, active, completed, failed) using MongoDB or Redis
- **Storage Agnostic**: Switch between storage providers without changing your application code
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

### Inject the Producer Service

```typescript
import { Injectable } from '@nestjs/common';
import { ProducerService, TaskStatus } from 'nestjs-cloud-taskmq';

@Injectable()
export class EmailService {
  constructor(private readonly producerService: ProducerService) {}

  async sendWelcomeEmail(userId: string, email: string): Promise<void> {
    // Add a task to the email-queue
    const result = await this.producerService.addTask(
      'email-queue', // Queue name as registered in the module
      {
        type: 'welcome',
        userId,
        email,
        subject: 'Welcome to our platform!',
      },
      {
        // Optional: Schedule for the future
        scheduleTime: new Date(Date.now() + 60000), // 1 minute from now
        // Optional: Additional metadata
        metadata: {
          priority: 'high',
          department: 'onboarding',
        },
      },
    );

    console.log(`Email task created with ID: ${result.taskId}`);
  }

  async getEmailTaskStatus(taskId: string): Promise<string> {
    const task = await this.producerService.getTask(taskId);
    return task ? task.status : 'not-found';
  }

  async getFailedEmailTasks(): Promise<any[]> {
    // Find all failed tasks in the email-queue
    return await this.producerService.findTasks(
      'email-queue',     // Queue name
      TaskStatus.FAILED, // Status filter
      10,                // Limit
      0                  // Skip (for pagination)
    );
  }

  async getQueueStats(): Promise<Record<string, number>> {
    // Get count of tasks in each status for email-queue
    return await this.producerService.getQueueStatusCounts('email-queue');
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
}),
```

### Custom Storage Adapter

You can create your own storage adapter by implementing the `IStateStorageAdapter` interface:

```typescript
import { Injectable } from '@nestjs/common';
import { IStateStorageAdapter, TaskQueryOptions, ITask, TaskStatus } from 'nestjs-cloud-taskmq';

@Injectable()
export class CustomStorageAdapter implements IStateStorageAdapter {
  // Implement all required methods
  async initialize(): Promise<void> {
    // Initialize your storage connection
  }

  async createTask(task: Omit<ITask, 'createdAt' | 'updatedAt'>): Promise<ITask> {
    // Implement task creation
  }

  // ... implement all other interface methods
}

// Then register it:
{
  provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
  useClass: CustomStorageAdapter,
}
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

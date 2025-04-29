/**
 * Example of how to configure and register the CloudTaskMQ module in a NestJS application
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CloudTaskMQModule } from '../src';
import { EmailProcessor } from './consumer-example';
import { EmailService } from './producer-example';

/**
 * Example module using static configuration
 */
@Module({
  imports: [
    CloudTaskMQModule.forRoot({
      projectId: 'my-gcp-project',
      location: 'us-central1',
      defaultProcessorUrl: 'https://my-app.example.com/api/cloud-tasks',
      queues: [
        {
          name: 'email-queue',
          path: 'projects/my-gcp-project/locations/us-central1/queues/email-queue',
          serviceAccountEmail: 'cloud-tasks@my-gcp-project.iam.gserviceaccount.com',
        },
        {
          name: 'notification-queue',
          path: 'projects/my-gcp-project/locations/us-central1/queues/notification-queue',
        },
      ],
      storageAdapter: 'mongo',
      storageOptions: {
        mongoUri: 'mongodb://localhost:27017/taskdb',
        collectionName: 'cloud_tasks',
      },
      // How long to hold a task lock for (default: 60000 ms)
      lockDurationMs: 120000, // 2 minutes
    }),
  ],
  providers: [
    // Register your processors and services
    EmailProcessor,
    EmailService,
    // ... other providers that use the CloudTaskMQ services
  ],
  exports: [
    // Export services that other modules might need
    EmailService,
  ],
})
export class StaticConfigTasksModule {}

/**
 * Example module using async configuration (recommended for production)
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    CloudTaskMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        projectId: configService.get('GCP_PROJECT_ID'),
        location: configService.get('GCP_LOCATION'),
        defaultProcessorUrl: configService.get('CLOUD_TASKS_URL'),
        queues: [
          {
            name: 'email-queue',
            path: `projects/${configService.get('GCP_PROJECT_ID')}/locations/${configService.get('GCP_LOCATION')}/queues/email-queue`,
            serviceAccountEmail: configService.get('GCP_SERVICE_ACCOUNT'),
          },
          {
            name: 'notification-queue',
            path: `projects/${configService.get('GCP_PROJECT_ID')}/locations/${configService.get('GCP_LOCATION')}/queues/notification-queue`,
          },
        ],
        storageAdapter: configService.get('STORAGE_ADAPTER') || 'mongo',
        storageOptions: {
          // MongoDB options
          mongoUri: configService.get('MONGODB_URI'),
          collectionName: configService.get('TASKS_COLLECTION_NAME') || 'cloud_tasks',
          
          // Redis options (if using Redis adapter)
          redis: {
            host: configService.get('REDIS_HOST'),
            port: parseInt(configService.get('REDIS_PORT') || '6379'),
            password: configService.get('REDIS_PASSWORD'),
          },
        },
        lockDurationMs: parseInt(configService.get('TASK_LOCK_DURATION_MS') || '60000'),
      }),
    }),
  ],
  providers: [EmailProcessor, EmailService],
  exports: [EmailService],
})
export class AsyncConfigTasksModule {}

/**
 * Example of a custom controller for handling Cloud Tasks requests
 */
import { Controller, Post, Body } from '@nestjs/common';
import { CloudTaskConsumer } from '../src';

@CloudTaskConsumer({
  queues: ['email-queue', 'notification-queue'],
  path: 'tasks', // Will be available at /tasks instead of the default /cloud-tasks
  validateOidcToken: true,
})
export class CustomTasksController {
  @Post()
  async handleTask(@Body() body: any): Promise<any> {
    // Additional custom logic before the task is processed by ConsumerService
    console.log(`Received task ${body.taskId} for queue ${body.queueName}`);
    
    // The actual processing is handled by the CloudTaskMQ library
    return { received: true };
  }
}

// Don't forget to register the controller in your module
@Module({
  imports: [CloudTaskMQModule.forRoot(/* ... */)],
  controllers: [CustomTasksController],
  providers: [EmailProcessor, EmailService],
})
export class TasksModule {}

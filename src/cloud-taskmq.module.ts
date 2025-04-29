import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ProducerService } from './services/producer.service';
import { ConsumerService } from './services/consumer.service';
import { TaskController } from './controllers/task.controller';
import { 
  CloudTaskMQAsyncConfig, 
  CloudTaskMQConfig, 
  CloudTaskMQConfigFactory 
} from './interfaces/config.interface';
import { 
  CLOUD_TASKMQ_CONFIG, 
  CLOUD_TASKMQ_STORAGE_ADAPTER 
} from './utils/constants';
import { createStorageAdapterProvider } from './utils/storage-adapter.factory';
import { MongoStorageAdapter } from './adapters/mongo-storage.adapter';
import { RedisStorageAdapter } from './adapters/redis-storage.adapter';
import { TaskSchema } from './adapters/mongo-storage.adapter';

/**
 * Main module for CloudTaskMQ. Use forRoot or forRootAsync to configure and register.
 */
@Global()
@Module({})
export class CloudTaskMQModule {
  /**
   * Register the CloudTaskMQ module with static configuration
   * 
   * @param config Configuration for the CloudTaskMQ module
   * @returns Dynamic module
   * 
   * @example
   * ```typescript
   * @Module({
   *   imports: [
   *     CloudTaskMQModule.forRoot({
   *       projectId: 'my-gcp-project',
   *       location: 'us-central1',
   *       defaultProcessorUrl: 'https://my-app.com/api/cloud-tasks',
   *       queues: [
   *         {
   *           name: 'email-queue',
   *           path: 'projects/my-gcp-project/locations/us-central1/queues/email-queue',
   *           serviceAccountEmail: 'my-service-account@my-gcp-project.iam.gserviceaccount.com',
   *         }
   *       ],
   *       storageAdapter: 'mongo',
   *       storageOptions: {
   *         mongoUri: 'mongodb://localhost:27017/cloud-taskmq',
   *       },
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(config: CloudTaskMQConfig): DynamicModule {
    // Setup providers
    const configProvider: Provider = {
      provide: CLOUD_TASKMQ_CONFIG,
      useValue: config,
    };

    // Create modules array with required modules
    const imports: any[] = [DiscoveryModule];

    // Only add MongoDB if the storage adapter is 'mongo'
    if (config.storageAdapter === 'mongo') {
      imports.push(
        MongooseModule.forRoot(config.storageOptions.mongoUri),
        MongooseModule.forFeature([
          { name: 'CloudTaskMQTask', schema: TaskSchema, collection: config.storageOptions.collectionName || 'cloud_taskmq_tasks' }
        ])
      );
    }

    return {
      module: CloudTaskMQModule,
      global: true,
      imports,
      controllers: [TaskController],
      providers: [
        configProvider,
        ProducerService,
        ConsumerService,
        createStorageAdapterProvider(config),
      ],
      exports: [ProducerService, ConsumerService],
    };
  }

  /**
   * Register the CloudTaskMQ module with async configuration
   * 
   * @param config Async configuration options
   * @returns Dynamic module
   * 
   * @example
   * ```typescript
   * @Module({
   *   imports: [
   *     ConfigModule.forRoot(),
   *     CloudTaskMQModule.forRootAsync({
   *       imports: [ConfigModule],
   *       inject: [ConfigService],
   *       useFactory: (configService: ConfigService) => ({
   *         projectId: configService.get('GCP_PROJECT_ID'),
   *         location: configService.get('GCP_LOCATION'),
   *         defaultProcessorUrl: configService.get('PROCESSOR_URL'),
   *         queues: [
   *           {
   *             name: 'email-queue',
   *             path: `projects/${configService.get('GCP_PROJECT_ID')}/locations/${configService.get('GCP_LOCATION')}/queues/email-queue`,
   *             serviceAccountEmail: configService.get('GCP_SERVICE_ACCOUNT'),
   *           }
   *         ],
   *         storageAdapter: 'mongo',
   *         storageOptions: {
   *           mongoUri: configService.get('MONGODB_URI'),
   *         },
   *       }),
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRootAsync(asyncConfig: CloudTaskMQAsyncConfig): DynamicModule {
    // Create config provider
    const configProvider = this.createAsyncConfigProvider(asyncConfig);

    // Setup initial imports
    const imports: any[] = [DiscoveryModule, ...(asyncConfig.imports || [])];

    // Create custom storage adapter provider
    const storageAdapterProvider: Provider = {
      provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
      useFactory: async (config: CloudTaskMQConfig) => {
        const { storageAdapter, storageOptions } = config;
        
        switch (storageAdapter) {
          case 'mongo':
            return new MongoStorageAdapter(
              undefined, // connection will be injected by NestJS
              undefined  // model will be injected by NestJS
            );
          case 'redis':
            return new RedisStorageAdapter({
              host: storageOptions.redis?.host,
              port: storageOptions.redis?.port,
              password: storageOptions.redis?.password,
              url: storageOptions.redis?.url,
              keyPrefix: storageOptions.redis?.keyPrefix,
            });
          default:
            throw new Error(`Unsupported storage adapter: ${storageAdapter}`);
        }
      },
      inject: [CLOUD_TASKMQ_CONFIG],
    };

    // Create providers array
    const providers = [
      configProvider,
      storageAdapterProvider,
      ProducerService,
      ConsumerService,
    ];

    // Return the dynamic module
    return {
      module: CloudTaskMQModule,
      global: true,
      imports: [
        ...imports,
        // This factory approach solves the circular dependency issue
        MongooseModule.forRootAsync({
          useFactory: async () => ({
            uri: 'mongodb://dummy-uri', // This will be overridden by the connection factory
          }),
        }),
        MongooseModule.forFeatureAsync([
          {
            name: 'CloudTaskMQTask',
            useFactory: (config: CloudTaskMQConfig) => {
              const collectionName = config.storageOptions.collectionName || 'cloud_taskmq_tasks';
              return {
                schema: TaskSchema,
                collection: collectionName,
              };
            },
            inject: [CLOUD_TASKMQ_CONFIG],
          },
        ]),
      ],
      controllers: [TaskController],
      providers,
      exports: [ProducerService, ConsumerService],
    };
  }

  /**
   * Create async config provider
   * @internal
   */
  private static createAsyncConfigProvider(options: CloudTaskMQAsyncConfig): Provider {
    if (options.useFactory) {
      return {
        provide: CLOUD_TASKMQ_CONFIG,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    if (options.useClass) {
      return {
        provide: CLOUD_TASKMQ_CONFIG,
        useFactory: async (configFactory: CloudTaskMQConfigFactory) =>
          await configFactory.createCloudTaskMQConfig(),
        inject: [options.useClass],
      };
    }

    if (options.useExisting) {
      return {
        provide: CLOUD_TASKMQ_CONFIG,
        useFactory: async (configFactory: CloudTaskMQConfigFactory) =>
          await configFactory.createCloudTaskMQConfig(),
        inject: [options.useExisting],
      };
    }

    throw new Error('Invalid CloudTaskMQAsyncConfig. Must provide useFactory, useClass, or useExisting.');
  }
}

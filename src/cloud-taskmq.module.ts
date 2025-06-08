import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  ModuleRef,
} from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { ProducerService } from './services/producer.service';
import { ConsumerService } from './services/consumer.service';
import { TaskController } from './controllers/task.controller';
import {
  CloudTaskMQAsyncConfig,
  CloudTaskMQConfig,
  CloudTaskMQConfigFactory,
} from './interfaces/config.interface';
import {
  CLOUD_TASKMQ_CONFIG,
  CLOUD_TASKMQ_STORAGE_ADAPTER,
  MONGODB_DYNAMIC_MODULES_SETUP,
} from './utils/constants';
import { createStorageAdapterProvider } from './utils/storage-adapter.factory';
import { MongoStorageAdapter } from './adapters/mongo-storage.adapter';
import { RedisStorageAdapter } from './adapters/redis-storage.adapter';
import { MemoryStorageAdapter } from './adapters/memory-storage.adapter';
import { IStateStorageAdapter } from './interfaces/storage-adapter.interface';
import { Connection } from 'mongoose';
import { CloudTaskProcessorInterceptor } from './interceptors/cloud-task-processor.interceptor';
import { RateLimiterService } from './services/rate-limiter.service';
import { ConfigService } from '@nestjs/config';
import {
  CUSTOM_STORAGE_ADAPTER,
  MEMORY_STORAGE_ADAPTER,
  MONGO_STORAGE_ADAPTER,
  REDIS_STORAGE_ADAPTER,
} from './adapters/types';
import { ScheduleModule } from '@nestjs/schedule';

function validateConfig(config: CloudTaskMQConfig): void {
  if (!config.projectId) {
    throw new Error('CloudTaskMQ config must include a projectId');
  }

  if (!config.location) {
    throw new Error('CloudTaskMQ config must include a location');
  }

  // Validate storage adapter
  if (!config.storageAdapter) {
    throw new Error('CloudTaskMQ config must include a storageAdapter');
  }

  if (
    config.storageAdapter === 'redis' &&
    !config.storageOptions?.redis?.url &&
    !config.storageOptions?.redis?.host
  ) {
    throw new Error(
      'Redis storage adapter requires either url or host in storageOptions.redis',
    );
  }

  // Validate queues configuration
  if (
    !config.queues ||
    !Array.isArray(config.queues) ||
    config.queues.length === 0
  ) {
    throw new Error('CloudTaskMQ config must include at least one queue');
  }

  for (const queue of config.queues) {
    if (!queue.name || !queue.path) {
      throw new Error('Each queue must have a name and path');
    }
  }
}

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
    // Validate configuration
    validateConfig(config);

    // Setup providers
    const configProvider: Provider = {
      provide: CLOUD_TASKMQ_CONFIG,
      useValue: config,
    };

    // Create modules array with required modules
    const imports: any[] = [DiscoveryModule, ScheduleModule.forRoot()];

    // Only add MongoDB if the storage adapter is 'mongo'
    if (config.storageAdapter === MONGO_STORAGE_ADAPTER) {
      imports.push(MongooseModule.forRoot(config.storageOptions.mongoUri));
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
        RateLimiterService,
        CloudTaskProcessorInterceptor,
        createStorageAdapterProvider(),
      ],
      exports: [ProducerService, ConsumerService, RateLimiterService],
    };
  }

  /**
   * Register the CloudTaskMQ module with async configuration
   *
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
   * @param asyncConfig
   */
  static forRootAsync(asyncConfig: CloudTaskMQAsyncConfig): DynamicModule {
    // Create config provider first - this needs to be available before any dynamic imports
    const configProvider =
      CloudTaskMQModule.createAsyncConfigProvider(asyncConfig);

    // Setup base imports - every configuration needs DiscoveryModule
    const imports = [
      DiscoveryModule,
      ScheduleModule.forRoot(),
      ...(asyncConfig.imports || []),
    ];

    // Create custom providers array
    const providers = [
      configProvider,
      CloudTaskProcessorInterceptor,
      // Properly configure ProducerService with injection
      {
        provide: ProducerService,
        useFactory: (
          config: CloudTaskMQConfig,
          storageAdapter: IStateStorageAdapter,
          configService: ConfigService,
          discoveryService: DiscoveryService,
        ) => {
          return new ProducerService(
            config,
            storageAdapter,
            configService,
            discoveryService,
          );
        },
        inject: [
          CLOUD_TASKMQ_CONFIG,
          CLOUD_TASKMQ_STORAGE_ADAPTER,
          ConfigService,
          DiscoveryService,
        ],
      },
      // Properly configure ConsumerService with injection
      {
        provide: ConsumerService,
        useFactory: (
          discoveryService: DiscoveryService,
          metadataScanner: MetadataScanner,
          moduleRef: ModuleRef,
          config: CloudTaskMQConfig,
          storageAdapter: IStateStorageAdapter,
          rateLimiterService: RateLimiterService,
          producerService: ProducerService,
        ) => {
          return new ConsumerService(
            discoveryService,
            metadataScanner,
            moduleRef,
            config,
            storageAdapter,
            rateLimiterService,
            producerService,
          );
        },
        inject: [
          DiscoveryService,
          MetadataScanner,
          ModuleRef,
          CLOUD_TASKMQ_CONFIG,
          CLOUD_TASKMQ_STORAGE_ADAPTER,
          RateLimiterService,
          ProducerService,
        ],
      },
      {
        provide: RateLimiterService,
        useFactory: (storageAdapter: IStateStorageAdapter) => {
          return new RateLimiterService(storageAdapter);
        },
        inject: [CLOUD_TASKMQ_STORAGE_ADAPTER],
      },
      {
        provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
        useFactory: async (
          config: CloudTaskMQConfig,
          connection: Connection,
        ) => {
          const { storageAdapter, storageOptions } = config;
          let adapter: IStateStorageAdapter;

          switch (storageAdapter) {
            case MONGO_STORAGE_ADAPTER:
              adapter = new MongoStorageAdapter(
                connection,
                storageOptions.collectionName,
              );

              if (connection && adapter instanceof MongoStorageAdapter) {
                // Do any additional setup for MongoDB adapter if needed
              }
              break;
            case REDIS_STORAGE_ADAPTER:
              adapter = new RedisStorageAdapter({
                host: storageOptions.redis?.host,
                port: storageOptions.redis?.port,
                password: storageOptions.redis?.password,
                url: storageOptions.redis?.url,
                keyPrefix: storageOptions.redis?.keyPrefix,
              });
              break;
            case MEMORY_STORAGE_ADAPTER:
              adapter = new MemoryStorageAdapter();
              break;
            case CUSTOM_STORAGE_ADAPTER:
              if (!config.customStorageAdapterInstance) {
                throw new Error(
                  'Storage adapter type is "custom" but no customStorageAdapterInstance was provided in CloudTaskMQConfig.',
                );
              }
              adapter = config.customStorageAdapterInstance;
              break;
            default:
              throw new Error(`Unsupported storage adapter: ${storageAdapter}`);
          }

          // Initialize the adapter
          try {
            await adapter.initialize();
          } catch {}

          return adapter;
        },
        inject: [
          CLOUD_TASKMQ_CONFIG,
          { token: getConnectionToken(), optional: true },
        ],
      },
      {
        provide: MONGODB_DYNAMIC_MODULES_SETUP,
        useFactory: (config: CloudTaskMQConfig) => {
          if (config.storageAdapter === MONGO_STORAGE_ADAPTER) {
            imports.push(
              MongooseModule.forRoot(config.storageOptions.mongoUri),
            );
          }
          return true;
        },
        inject: [CLOUD_TASKMQ_CONFIG],
      },
    ];

    return {
      module: CloudTaskMQModule,
      global: true,
      imports,
      controllers: [TaskController],
      providers,
      exports: [ProducerService, ConsumerService, RateLimiterService],
    };
  }

  /**
   * Create async config provider
   * @internal
   */
  private static createAsyncConfigProvider(
    options: CloudTaskMQAsyncConfig,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: CLOUD_TASKMQ_CONFIG,
        useFactory: async (...args) => {
          const config = await options.useFactory(...args);
          validateConfig(config);
          return config;
        },
        inject: options.inject || [],
      };
    }

    if (options.useClass) {
      return {
        provide: CLOUD_TASKMQ_CONFIG,
        useFactory: async (configFactory: CloudTaskMQConfigFactory) => {
          const config = await configFactory.createCloudTaskMQConfig();
          validateConfig(config);
          return config;
        },
        inject: [options.useClass],
      };
    }

    if (options.useExisting) {
      return {
        provide: CLOUD_TASKMQ_CONFIG,
        useFactory: async (configFactory: CloudTaskMQConfigFactory) => {
          const config = await configFactory.createCloudTaskMQConfig();
          validateConfig(config);
          return config;
        },
        inject: [options.useExisting],
      };
    }
    throw new Error(
      'Invalid CloudTaskMQAsyncConfig. Must provide useFactory, useClass, or useExisting.',
    );
  }
}

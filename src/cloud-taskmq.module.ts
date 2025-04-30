import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import {MongooseModule, getModelToken, getConnectionToken} from '@nestjs/mongoose';
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
import { MemoryStorageAdapter } from './adapters/memory-storage.adapter';
import { TaskSchema } from './adapters/mongo-storage.adapter';
import { IStateStorageAdapter } from './interfaces/storage-adapter.interface';
import {Connection, Model} from "mongoose";
import {ITask} from "./interfaces/task.interface";

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
    // Create config provider first - this needs to be available before any dynamic imports
    const configProvider: Provider = this.createAsyncConfigProvider(asyncConfig);

    // Create custom providers array
    const providers = [
      configProvider,
      {
        provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
        useFactory: (config: CloudTaskMQConfig, connection: Connection, model: Model<ITask>) => {
          const { storageAdapter, storageOptions } = config;

          switch (storageAdapter) {
            case 'mongo':
              return new MongoStorageAdapter(
                connection, // connection will be injected by NestJS
                model,  // model will be injected by NestJS
                storageOptions.collectionName
            );
            case 'redis':
              return new RedisStorageAdapter({
                host: storageOptions.redis?.host,
                port: storageOptions.redis?.port,
                password: storageOptions.redis?.password,
                url: storageOptions.redis?.url,
                keyPrefix: storageOptions.redis?.keyPrefix,
              });
            case 'memory':
              return new MemoryStorageAdapter();
            default:
              throw new Error(`Unsupported storage adapter: ${storageAdapter}`);
          }
        },
        inject: [
            CLOUD_TASKMQ_CONFIG,
            { token: getConnectionToken(), optional: true },
            { token: getModelToken('CloudTaskMQTask'), optional: true }
        ],
      },
      // Properly configure ProducerService with injection
      {
        provide: ProducerService,
        useFactory: (config: CloudTaskMQConfig, storageAdapter: IStateStorageAdapter) => {
          return new ProducerService(config, storageAdapter);
        },
        inject: [CLOUD_TASKMQ_CONFIG, CLOUD_TASKMQ_STORAGE_ADAPTER],
      },
      // Properly configure ConsumerService with injection
      {
        provide: ConsumerService,
        useFactory: (
          discoveryService: DiscoveryService,
          metadataScanner: MetadataScanner,
          moduleRef: ModuleRef,
          config: CloudTaskMQConfig,
          storageAdapter: IStateStorageAdapter
        ) => {
          return new ConsumerService(
            discoveryService,
            metadataScanner,
            moduleRef,
            config,
            storageAdapter
          );
        },
        inject: [
          DiscoveryService,
          MetadataScanner,
          ModuleRef,
          CLOUD_TASKMQ_CONFIG,
          CLOUD_TASKMQ_STORAGE_ADAPTER
        ],
      }
    ];

    // Setup base imports - every configuration needs DiscoveryModule
    const imports = [DiscoveryModule, ...(asyncConfig.imports || [])];

    // Create a special MongoDB configuration factory
    const mongoConfigFactory = {
      provide: 'MONGODB_OPTIONS_FACTORY',
      useFactory: (config: CloudTaskMQConfig) => {
        if (config.storageAdapter === 'mongo') {
          return {
            uri: config.storageOptions.mongoUri,
            collectionName: config.storageOptions.collectionName || 'cloud_taskmq_tasks'
          };
        }
        return null;
      },
      inject: [CLOUD_TASKMQ_CONFIG],
    };

    // Add MongoDB factory to providers
    providers.push(mongoConfigFactory);

    // Setup MongoDB modules for mongo adapter type only
    providers.push({
      provide: 'MONGODB_CONNECTION_FACTORY',
      useFactory: (config: CloudTaskMQConfig, mongoOptions: any) => {
        if (config.storageAdapter === 'mongo' && mongoOptions) {
          // Create and inject a custom provider for the mongo storage adapter
          providers.push({
            provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
            useFactory: async (connection, model: any) => {
              const adapter = new MongoStorageAdapter(connection, model, mongoOptions.collectionName);
              // Explicitly call initialize to ensure the adapter is ready
              await adapter.initialize();
              return adapter;
            },
            inject: [
                { token: getConnectionToken(), optional: true },
                { token: getModelToken('CloudTaskMQTask'), optional: true }
            ],
          });

          // Add MongoDB modules to imports
          imports.push(
            MongooseModule.forRoot(mongoOptions.uri),
            MongooseModule.forFeature([
              {
                name: 'CloudTaskMQTask',
                schema: TaskSchema,
                collection: mongoOptions.collectionName
              }
            ])
          );
        }
        return true;
      },
      inject: [CLOUD_TASKMQ_CONFIG, 'MONGODB_OPTIONS_FACTORY'],
    });

    return {
      module: CloudTaskMQModule,
      global: true,
      imports,
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

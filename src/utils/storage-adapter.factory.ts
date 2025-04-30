import { Provider } from '@nestjs/common';
import { CLOUD_TASKMQ_CONFIG, CLOUD_TASKMQ_STORAGE_ADAPTER } from './constants';
import { CloudTaskMQConfig } from '../interfaces/config.interface';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import { MongoStorageAdapter } from '../adapters/mongo-storage.adapter';
import { RedisStorageAdapter } from '../adapters/redis-storage.adapter';
import { MemoryStorageAdapter } from '../adapters/memory-storage.adapter';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';

/**
 * Creates the appropriate storage adapter provider based on the configuration
 * 
 * @param config CloudTaskMQ configuration
 * @returns Provider for the storage adapter
 */
export function createStorageAdapterProvider(config: CloudTaskMQConfig): Provider {
  return {
    provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
    useFactory: async (config: CloudTaskMQConfig, connection: any, taskModel: any): Promise<IStateStorageAdapter> => {
      const { storageAdapter, storageOptions } = config;
      let adapter: IStateStorageAdapter;

      // Create the appropriate storage adapter based on configuration
      switch (storageAdapter) {
        case 'mongo':
          adapter = new MongoStorageAdapter(
              connection,
              taskModel,
              storageOptions.collectionName
          );
          break;
        case 'redis':
          adapter = new RedisStorageAdapter({
            host: storageOptions.redis?.host,
            port: storageOptions.redis?.port,
            password: storageOptions.redis?.password,
            url: storageOptions.redis?.url,
            keyPrefix: storageOptions.redis?.keyPrefix,
          });
          break;
        case 'memory':
          adapter = new MemoryStorageAdapter();
          break;
        default:
          throw new Error(`Unsupported storage adapter: ${storageAdapter}`);
      }

      // Initialize the adapter
      try {
        await adapter.initialize();
        console.log(`Successfully initialized ${storageAdapter} adapter`);
      } catch (error) {
        console.error(`Failed to initialize ${storageAdapter} adapter:`, error);
        throw error;
      }

      return adapter;
    },
    inject: [
      CLOUD_TASKMQ_CONFIG,
      { token: getConnectionToken(), optional: true },
      { token: getModelToken('CloudTaskMQTask'), optional: true }
    ],
  };
}

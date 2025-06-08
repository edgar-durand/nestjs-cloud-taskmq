import { Provider } from '@nestjs/common';
import { CLOUD_TASKMQ_CONFIG, CLOUD_TASKMQ_STORAGE_ADAPTER } from './constants';
import { CloudTaskMQConfig } from '../interfaces/config.interface';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import { MongoStorageAdapter } from '../adapters/mongo-storage.adapter';
import { RedisStorageAdapter } from '../adapters/redis-storage.adapter';
import { MemoryStorageAdapter } from '../adapters/memory-storage.adapter';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  CUSTOM_STORAGE_ADAPTER,
  MEMORY_STORAGE_ADAPTER,
  MONGO_STORAGE_ADAPTER,
  REDIS_STORAGE_ADAPTER,
} from '../adapters/types';

/**
 * Creates the appropriate storage adapter provider based on the configuration
 *
 * @returns Provider for the storage adapter
 */
export function createStorageAdapterProvider(): Provider {
  return {
    provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
    useFactory: async (
      config: CloudTaskMQConfig,
      connection: any,
    ): Promise<IStateStorageAdapter> => {
      const { storageAdapter, storageOptions, customStorageAdapterInstance } =
        config;
      let adapter: IStateStorageAdapter;

      // Create the appropriate storage adapter based on configuration
      switch (storageAdapter) {
        case MONGO_STORAGE_ADAPTER:
          adapter = new MongoStorageAdapter(
            connection,
            storageOptions.collectionName,
          );
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
          if (!customStorageAdapterInstance) {
            throw new Error(
              'Storage adapter type is "custom" but no customStorageAdapterInstance was provided in CloudTaskMQConfig.',
            );
          }
          adapter = customStorageAdapterInstance;
          break;
        default:
          throw new Error(`Unsupported storage adapter: ${storageAdapter}`);
      }

      // Initialize the adapter
      try {
        await adapter.initialize();
      } catch (error) {
        throw error;
      }

      return adapter;
    },
    inject: [
      CLOUD_TASKMQ_CONFIG,
      { token: getConnectionToken(), optional: true },
    ],
  };
}

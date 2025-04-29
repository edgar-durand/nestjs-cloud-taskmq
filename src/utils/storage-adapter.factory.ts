import { Provider } from '@nestjs/common';
import { CLOUD_TASKMQ_CONFIG, CLOUD_TASKMQ_STORAGE_ADAPTER } from './constants';
import { CloudTaskMQConfig } from '../interfaces/config.interface';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';
import { MongoStorageAdapter } from '../adapters/mongo-storage.adapter';
import { RedisStorageAdapter } from '../adapters/redis-storage.adapter';
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
    useFactory: (config: CloudTaskMQConfig, connection: any, taskModel: any): IStateStorageAdapter => {
      const { storageAdapter, storageOptions } = config;
      
      // Create the appropriate storage adapter based on configuration
      switch (storageAdapter) {
        case 'mongo':
          return new MongoStorageAdapter(connection, taskModel);
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
    inject: [
      CLOUD_TASKMQ_CONFIG,
      getConnectionToken(),
      getModelToken('CloudTaskMQTask')
    ],
  };
}

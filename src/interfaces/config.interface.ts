import { ModuleMetadata, Type } from '@nestjs/common';
import { StorageAdapterType } from '../adapters/types';
import { IStateStorageAdapter } from './storage-adapter.interface';

/**
 * Rate limiter options for controlling task processing throughput
 */
export interface RateLimiterOptions {
  /**
   * Unique key for the rate limiter
   * Tasks with the same limiterKey will share the rate limit
   */
  limiterKey: string;

  /**
   * Number of tokens (operations) allowed in the time window
   */
  tokens: number;

  /**
   * Time window in milliseconds for token consumption
   */
  timeMS: number;
}

/**
 * Configuration for a Cloud Tasks queue
 */
export interface QueueConfig {
  /**
   * Name of the queue (used for referencing in code)
   */
  name: string;

  /**
   * Full path to the queue in Cloud Tasks (e.g., projects/my-project/locations/us-central1/queues/my-queue)
   */
  path: string;

  /**
   * Service account email to use for OIDC token generation (optional)
   */
  serviceAccountEmail?: string;

  /**
   * URL where tasks from this queue will be delivered (if different from default)
   */
  processorUrl?: string;

  /**
   * Queue-specific lock duration in milliseconds
   * Overrides the global lockDurationMs when specified
   */
  lockDurationMs?: number;

  /**
   * Rate limiter options for this queue
   * Controls how many tasks can be processed in a time window
   */
  rateLimiterOptions?: RateLimiterOptions[];
}

/**
 * Configuration for the CloudTaskMQ module
 */
export interface CloudTaskMQConfig {
  /**
   * GCP project ID
   */
  projectId: string;

  /**
   * GCP location
   */
  location: string;

  /**
   * Default URL where tasks will be pushed (can be overridden by individual queues)
   */
  defaultProcessorUrl?: string;

  /**
   * Maximum number of tasks to pull in a given pullingInterval across all queues for sending to GCP Cloud Task queues.
   * This value is automatically distributed among configured queues to ensure fair throttling.
   * @see pullingInterval
   *
   * @default 100000 - Based on GCP Cloud Tasks API rate limit of 100,000 requests/second per project
   * @example 50000 - pull up to 50,000 tasks per second
   * @link https://cloud.google.com/tasks/docs/quotas
   */
  maxTasksToPull?: number;

  /**
   * Represents the time interval, in milliseconds, at which maxTasksToPull should occur.
   *
   * @default 1000
   * @see maxTasksToPull
   */
  pullingInterval?: number;

  /**
   * List of queues to register with the library
   */
  queues: QueueConfig[];

  /**
   * Name of the storage adapter to use ('mongo', 'redis', 'memory', or 'custom')
   */
  storageAdapter: StorageAdapterType;

  /**
   * Storage adapter specific options
   */
  storageOptions: {
    /**
     * MongoDB connection string (for mongo adapter)
     */
    mongoUri?: string;

    /**
     * MongoDB collection name for tasks (for mongo adapter, defaults to 'cloud_taskmq_tasks')
     */
    collectionName?: string;

    /**
     * Redis connection options (for redis adapter)
     */
    redis?: {
      host?: string;
      port?: number;
      password?: string;
      url?: string;
      keyPrefix?: string;
    };

    /**
     * Custom adapter specific options
     */
    [key: string]: any;
  };

  /**
   * An instance of IStateStorageAdapter to use when storageAdapter is 'custom'.
   * This instance should be fully configured and initialized by the user.
   */
  customStorageAdapterInstance?: IStateStorageAdapter;

  /**
   * Default lock duration in milliseconds (how long a task stays locked while processing)
   */
  lockDurationMs?: number;

  /**
   * Automatically create missing queues in Cloud Tasks if they don't exist
   * If false (default), the module will throw an error if a queue doesn't exist
   * @default false
   */
  autoCreateQueues?: boolean;
}

/**
 * Interface for async config factory
 */
export interface CloudTaskMQConfigFactory {
  createCloudTaskMQConfig(): Promise<CloudTaskMQConfig> | CloudTaskMQConfig;
}

/**
 * Options for async module configuration
 */
export interface CloudTaskMQAsyncConfig
  extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Injection token for config
   */
  useExisting?: Type<CloudTaskMQConfigFactory>;

  /**
   * Class that implements config factory interface
   */
  useClass?: Type<CloudTaskMQConfigFactory>;

  /**
   * Factory function for config
   */
  useFactory?: (
    ...args: any[]
  ) => Promise<CloudTaskMQConfig> | CloudTaskMQConfig;

  /**
   * Dependencies to inject into factory function
   */
  inject?: any[];
}

import { ModuleMetadata, Type } from '@nestjs/common';

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
   * List of queues to register with the library
   */
  queues: QueueConfig[];
  
  /**
   * Name of the storage adapter to use ('mongo' or 'redis')
   */
  storageAdapter: 'mongo' | 'redis' | 'memory' | string;
  
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
   * Default lock duration in milliseconds (how long a task stays locked while processing)
   */
  lockDurationMs?: number;
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
export interface CloudTaskMQAsyncConfig extends Pick<ModuleMetadata, 'imports'> {
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
  useFactory?: (...args: any[]) => Promise<CloudTaskMQConfig> | CloudTaskMQConfig;
  
  /**
   * Dependencies to inject into factory function
   */
  inject?: any[];
}

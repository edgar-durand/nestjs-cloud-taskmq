export const MONGO_STORAGE_ADAPTER = 'mongo';
export const REDIS_STORAGE_ADAPTER = 'redis';
export const MEMORY_STORAGE_ADAPTER = 'memory';
export const CUSTOM_STORAGE_ADAPTER = 'custom';

export type StorageAdapterType =
  | typeof MONGO_STORAGE_ADAPTER
  | typeof REDIS_STORAGE_ADAPTER
  | typeof MEMORY_STORAGE_ADAPTER
  | typeof CUSTOM_STORAGE_ADAPTER;

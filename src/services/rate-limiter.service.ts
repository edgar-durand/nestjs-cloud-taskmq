// src/services/rate-limiter.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RateLimiterOptions } from '../interfaces/config.interface';
import { CLOUD_TASKMQ_STORAGE_ADAPTER } from '../utils/constants';
import { IStateStorageAdapter } from '../interfaces/storage-adapter.interface';

interface TokenBucket {
  key: string;
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillTimeMs: number;
}

const MAX_CACHE_SIZE = 1000;
const CACHE_TTL = 10 * 60 * 1000;

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly dynamicLimiters: Map<string, RateLimiterOptions> = new Map();
  // Use a Map with time-based expiration
  private readonly buckets: Map<string, { data: TokenBucket; expiry: number }> =
    new Map();

  constructor(
    @Inject(CLOUD_TASKMQ_STORAGE_ADAPTER)
    private readonly storageAdapter: IStateStorageAdapter,
  ) {}
  /**
   * Try to consume tokens for a specific rate limiter key
   * Works with both configured limiters and dynamic limiters
   *
   * @param options Rate limiter options or just the key for dynamic limiters
   * @returns true if tokens were consumed, false if rate limit exceeded
   */
  async tryConsume(options: RateLimiterOptions | string): Promise<boolean> {
    let limiterKey: string;
    let tokens: number;
    let timeMS: number;

    // Handle string key for dynamic limiters
    if (typeof options === 'string') {
      const dynamicLimiter = this.dynamicLimiters.get(options);
      if (!dynamicLimiter) {
        this.logger.warn(`No dynamic rate limiter found for key '${options}'`);
        return true; // No limiter means no limiting
      }

      limiterKey = options;
      tokens = dynamicLimiter.tokens;
      timeMS = dynamicLimiter.timeMS;
    } else {
      // Handle regular options object
      limiterKey = options.limiterKey;
      tokens = options.tokens;
      timeMS = options.timeMS;
    }

    // Check cache first
    let bucket = this.getBucketFromCache(limiterKey);
    // If not in cache, get from storage
    if (!bucket) {
      bucket = await this.storageAdapter.getRateLimiterBucket(limiterKey);

      if (!bucket) {
        // Create a new bucket if none exists
        bucket = {
          key: limiterKey,
          tokens,
          lastRefill: Date.now(),
          maxTokens: tokens,
          refillTimeMs: timeMS,
        };

        // Save to storage
        await this.storageAdapter.saveRateLimiterBucket(bucket);
        // Cache the new bucket
        this.setCachedBucket(limiterKey, bucket);
        return true;
      }
    }

    // Refill tokens based on elapsed time
    this.refillBucket(bucket);

    // Check if enough tokens are available
    if (bucket.tokens >= 1) {
      // Always consume 1 token per task
      bucket.tokens -= 1;
      this.logger.debug(
        `Consumed 1 token for key ${limiterKey}, ${bucket.tokens} remaining`,
      );

      // Save the updated bucket
      await this.storageAdapter.saveRateLimiterBucket(bucket);
      // Update cache with the modified bucket
      this.setCachedBucket(limiterKey, bucket);
      return true;
    }

    this.logger.debug(
      `Rate limit exceeded for key ${limiterKey}, available: ${bucket.tokens}`,
    );

    // Save the refilled bucket even though we didn't consume a token
    await this.storageAdapter.saveRateLimiterBucket(bucket);
    // Update cache with the refilled bucket
    this.setCachedBucket(limiterKey, bucket);
    return false;
  }

  /**
   * Calculate time in ms until tokens will be available
   */
  async getWaitTimeMs(options: RateLimiterOptions | string): Promise<number> {
    let limiterKey: string;

    // Handle string key for dynamic limiters
    if (typeof options === 'string') {
      const dynamicLimiter = this.dynamicLimiters.get(options);
      if (!dynamicLimiter) {
        return 0; // No limiter means no waiting
      }
      limiterKey = options;
    } else {
      limiterKey = options.limiterKey;
    }

    // Check cache first
    let bucket = this.getBucketFromCache(limiterKey);
    // If not in cache, get from storage
    if (!bucket) {
      bucket = await this.storageAdapter.getRateLimiterBucket(limiterKey);
      if (bucket) {
        // Cache the bucket for future use
        this.setCachedBucket(limiterKey, bucket);
      }
    }

    if (!bucket || bucket.tokens >= 1) {
      return 0;
    }

    // Calculate how many tokens we need (just 1 for now)
    const tokensToWaitFor = 1 - bucket.tokens;

    // Calculate refill rate (tokens per ms)
    const refillRate = bucket.maxTokens / bucket.refillTimeMs;

    // Calculate wait time
    const waitTimeMs = Math.ceil(tokensToWaitFor / refillRate);
    this.logger.debug(`Wait time for key ${limiterKey}: ${waitTimeMs}ms`);

    return waitTimeMs;
  }

  /**
   * Refill a token bucket based on elapsed time
   */
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsedMs = now - bucket.lastRefill;

    if (elapsedMs <= 0) {
      return;
    }

    // Calculate tokens to add based on elapsed time
    const tokensToAdd = (elapsedMs / bucket.refillTimeMs) * bucket.maxTokens;

    // Update bucket
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Register a new dynamic rate limiter that isn't defined in config
   * This allows for creating rate limiters at runtime, e.g., one per user
   *
   * @param options Rate limiter options
   * @returns True if registered, false if a limiter with this key already exists
   */
  registerDynamicLimiter(options: RateLimiterOptions): boolean {
    const { limiterKey } = options;
    try {
      if (this.dynamicLimiters.has(limiterKey)) {
        this.logger.debug(
          `Dynamic rate limiter with key '${limiterKey}' already exists`,
        );
        return false;
      }

      this.dynamicLimiters.set(limiterKey, options);
      this.logger.log(
        `Registered dynamic rate limiter with key '${limiterKey}'`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unregister a dynamic rate limiter
   * This frees up resources associated with the limiter
   *
   * @param limiterKey The key of the limiter to remove
   * @returns True if unregistered, false if limiter not found
   */
  unregisterDynamicLimiter(limiterKey: string): boolean {
    try {
      if (!this.dynamicLimiters.has(limiterKey)) {
        return false;
      }

      this.dynamicLimiters.delete(limiterKey);

      // Also remove from cache
      this.buckets.delete(limiterKey);

      // Asynchronously delete from storage but don't await
      this.storageAdapter
        .deleteRateLimiterBucket(limiterKey)
        .catch((err) =>
          this.logger.error(
            `Failed to delete rate limiter bucket: ${err.message}`,
          ),
        );

      this.logger.log(
        `Unregistered dynamic rate limiter with key '${limiterKey}'`,
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  private getBucketFromCache(key: string): TokenBucket | null {
    const cached = this.buckets.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
    // Remove expired entry
    if (cached) this.buckets.delete(key);
    return null;
  }

  private setCachedBucket(key: string, bucket: TokenBucket): void {
    // 10-minute TTL
    this.buckets.set(key, { data: bucket, expiry: Date.now() + CACHE_TTL });

    // Optionally enforce a maximum cache size
    if (this.buckets.size > MAX_CACHE_SIZE) {
      // Remove oldest entries
      const keysToDelete = [...this.buckets.keys()].slice(0, 100);
      keysToDelete.forEach((k) => this.buckets.delete(k));
    }
  }
}

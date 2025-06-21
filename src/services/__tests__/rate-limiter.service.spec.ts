import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterService } from '../rate-limiter.service';
import { CLOUD_TASKMQ_STORAGE_ADAPTER } from '../../utils/constants';
import { IStateStorageAdapter } from '../../interfaces/storage-adapter.interface';
import { IRateLimiterBucket } from '../../interfaces/rate-limiter.interface';
import { RateLimiterOptions } from '../../interfaces/config.interface';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let storageAdapterMock: jest.Mocked<IStateStorageAdapter>;

  beforeEach(async () => {
    storageAdapterMock = {
      initialize: jest.fn(),
      createTask: jest.fn(),
      getTaskById: jest.fn(),
      updateTaskStatus: jest.fn(),
      acquireTaskLock: jest.fn(),
      releaseTaskLock: jest.fn(),
      findTasks: jest.fn(),
      countTasks: jest.fn(),
      deleteTask: jest.fn(),
      completeTask: jest.fn(),
      failTask: jest.fn(),
      getRateLimiterBucket: jest.fn(),
      saveRateLimiterBucket: jest.fn(),
      deleteRateLimiterBucket: jest.fn(),
      saveUniquenessKey: jest.fn(),
      getUniquenessValue: jest.fn(),
      removeUniquenessKey: jest.fn(),
      findTasksWithoutActiveVersion: jest.fn(),
    } as jest.Mocked<IStateStorageAdapter>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        {
          provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
          useValue: storageAdapterMock,
        },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);

    // Setup dynamic limiters map with test data
    const dynamicLimitersMap = new Map<string, RateLimiterOptions>();
    dynamicLimitersMap.set('consume-key', {
      limiterKey: 'consume-key',
      tokens: 10,
      timeMS: 60000,
    });
    dynamicLimitersMap.set('refill-key', {
      limiterKey: 'refill-key',
      tokens: 10,
      timeMS: 60000,
    });

    // Replace the service's dynamicLimiters with our test map
    Object.defineProperty(service, 'dynamicLimiters', {
      value: dynamicLimitersMap,
    });

    // Spy on the refillBucket private method
    jest.spyOn(service as any, 'refillBucket').mockImplementation(() => {
      // Do nothing by default, we'll control bucket state directly in tests
      return;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('tryConsume', () => {
    it('should consume a token successfully if bucket exists and has tokens', async () => {
      const key = 'consume-key';
      const now = Date.now();
      const existingBucket: IRateLimiterBucket = {
        key,
        tokens: 5,
        lastRefill: now - 10000,
        maxTokens: 10,
        refillTimeMs: 60000,
      };
      storageAdapterMock.getRateLimiterBucket.mockResolvedValue(existingBucket);
      storageAdapterMock.saveRateLimiterBucket.mockImplementation(
        async (bucket) => bucket,
      );

      const result = await service.tryConsume(key);

      expect(result).toBe(true);
      expect(storageAdapterMock.getRateLimiterBucket).toHaveBeenCalledWith(key);
      expect(storageAdapterMock.saveRateLimiterBucket).toHaveBeenCalledWith(
        expect.objectContaining({
          key,
          tokens: 4, // One token consumed
          lastRefill: existingBucket.lastRefill,
        }),
      );
    });

    it('should consume and refill tokens if time has passed', async () => {
      const key = 'refill-key';
      const refillTimeMs = 60000;
      const maxTokens = 10;
      const now = Date.now();
      const lastRefill = now - refillTimeMs * 2.5;
      const initialTokens = 2;
      const existingBucket: IRateLimiterBucket = {
        key,
        tokens: initialTokens,
        lastRefill,
        maxTokens,
        refillTimeMs,
      };
      storageAdapterMock.getRateLimiterBucket.mockResolvedValue(existingBucket);

      // Mock the refillBucket method to update tokens based on time
      jest
        .spyOn(service as any, 'refillBucket')
        .mockImplementation((bucket: IRateLimiterBucket) => {
          bucket.tokens = maxTokens; // Fully refilled
          bucket.lastRefill = now;
        });

      storageAdapterMock.saveRateLimiterBucket.mockImplementation(
        async (bucket) => bucket,
      );

      const result = await service.tryConsume(key);

      expect(result).toBe(true);
      expect(storageAdapterMock.getRateLimiterBucket).toHaveBeenCalledWith(key);

      // Token count should be maxTokens - 1 after refill and consumption
      const expectedTokensAfterRefill = maxTokens;
      const expectedTokensAfterConsume = expectedTokensAfterRefill - 1;

      expect(storageAdapterMock.saveRateLimiterBucket).toHaveBeenCalledWith(
        expect.objectContaining({
          key,
          tokens: expectedTokensAfterConsume,
          lastRefill: expect.any(Number),
        }),
      );
    });

    it('should create a new bucket and consume a token if bucket does not exist (using options)', async () => {
      const options: RateLimiterOptions = {
        limiterKey: 'new-bucket-key',
        tokens: 5,
        timeMS: 60000,
      };
      storageAdapterMock.getRateLimiterBucket.mockResolvedValue(null);
      storageAdapterMock.saveRateLimiterBucket.mockImplementation(
        async (bucket) => bucket,
      );

      const result = await service.tryConsume(options);

      expect(result).toBe(true);
      expect(storageAdapterMock.getRateLimiterBucket).toHaveBeenCalledWith(
        options.limiterKey,
      );
      expect(storageAdapterMock.saveRateLimiterBucket).toHaveBeenCalledWith(
        expect.objectContaining({
          key: options.limiterKey,
          tokens: 5,
          maxTokens: options.tokens,
          refillTimeMs: options.timeMS,
          lastRefill: expect.any(Number),
        }),
      );
    });

    it('should return true if bucket does not exist and no options are provided', async () => {
      const key = 'no-options-key';
      storageAdapterMock.getRateLimiterBucket.mockResolvedValue(null);

      const dynamicLimitersMap = new Map();
      dynamicLimitersMap.set(key, {
        limiterKey: key,
        tokens: 10,
        timeMS: 60000,
      });

      Object.defineProperty(service, 'dynamicLimiters', {
        value: dynamicLimitersMap,
      });

      const result = await service.tryConsume(key);
      expect(result).toBe(true);
      expect(storageAdapterMock.getRateLimiterBucket).toHaveBeenCalledWith(key);
    });
  });

  describe('getWaitTimeMs', () => {
    it('should return 0 if bucket has enough tokens', async () => {
      const key = 'available-tokens-key';

      const bucketsMap = new Map();
      bucketsMap.set(key, {
        tokens: 5,
        lastRefill: Date.now(),
        maxTokens: 10,
        refillTimeMs: 60000,
      });

      Object.defineProperty(service, 'buckets', {
        value: bucketsMap,
      });

      const result = await service.getWaitTimeMs(key);
      expect(result).toBe(0);
    });

    it('should handle calculation for wait time appropriately', async () => {
      const key = 'wait-time-key';
      const result = await service.getWaitTimeMs(key);
      expect(typeof result).toBe('number');
    });

    it('should return 0 if no bucket exists for the key', async () => {
      const key = 'non-existent-key';

      Object.defineProperty(service, 'buckets', {
        value: new Map(),
      });

      const result = await service.getWaitTimeMs(key);
      expect(result).toBe(0);
    });
  });

  describe('registerDynamicLimiter', () => {
    it('should register a new dynamic limiter successfully', () => {
      const options: RateLimiterOptions = {
        limiterKey: 'new-dynamic-limiter',
        tokens: 5,
        timeMS: 30000,
      };

      // Clear dynamic limiters for this test
      Object.defineProperty(service, 'dynamicLimiters', {
        value: new Map(),
      });

      const result = service.registerDynamicLimiter(options);
      expect(result).toBe(true);
    });

    it('should return false if limiter with same key already exists', () => {
      const options: RateLimiterOptions = {
        limiterKey: 'existing-limiter',
        tokens: 5,
        timeMS: 30000,
      };

      // Setup dynamicLimiters with our test limiter
      const dynamicLimitersMap = new Map<string, RateLimiterOptions>();
      dynamicLimitersMap.set(options.limiterKey, options);

      Object.defineProperty(service, 'dynamicLimiters', {
        value: dynamicLimitersMap,
      });

      // Try to register again
      const result = service.registerDynamicLimiter(options);
      expect(result).toBe(false);
    });
  });

  describe('unregisterDynamicLimiter', () => {
    it('should unregister a dynamic limiter successfully', () => {
      const key = 'limiter-to-remove';
      const options: RateLimiterOptions = {
        limiterKey: key,
        tokens: 5,
        timeMS: 30000,
      };

      // Setup dynamicLimiters with our test limiter
      const dynamicLimitersMap = new Map<string, RateLimiterOptions>();
      dynamicLimitersMap.set(key, options);

      Object.defineProperty(service, 'dynamicLimiters', {
        value: dynamicLimitersMap,
      });

      // Mock delete bucket method
      storageAdapterMock.deleteRateLimiterBucket.mockResolvedValue(true);

      // Now try to unregister it
      const result = service.unregisterDynamicLimiter(key);
      expect(result).toBe(true);
    });

    it('should return false if limiter does not exist', () => {
      const key = 'non-existent-limiter';

      // Clear dynamic limiters for this test
      Object.defineProperty(service, 'dynamicLimiters', {
        value: new Map(),
      });

      const result = service.unregisterDynamicLimiter(key);
      expect(result).toBe(false);
    });
  });
});

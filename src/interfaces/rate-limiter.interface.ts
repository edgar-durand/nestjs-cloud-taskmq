export interface IRateLimiterBucket {
  key: string;
  tokens: number;
  lastRefill: number; // Timestamp in milliseconds (Date.now())
  maxTokens: number;
  refillTimeMs: number;
  createdAt?: Date;
  updatedAt?: Date;
}

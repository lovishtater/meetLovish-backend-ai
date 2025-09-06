const RateLimit = require('../models/RateLimit');
const database = require('../models/database');

class RateLimiter {
  constructor() {
    // Set rate limits: daily 200, hourly 50
    this.MAX_MESSAGES_PER_DAY = 200;
    this.MAX_MESSAGES_PER_HOUR = 50;

    // Fallback in-memory store for when database is unavailable
    this.fallbackStore = new Map();

    // Cache for rate limit checks (5 second TTL)
    this.cache = new Map();
    this.cacheTimeout = 5000; // 5 seconds
  }

  // Ensure database connection is ready
  async ensureDatabaseConnection() {
    if (!database.isConnectionReady()) {
      try {
        await database.connect();
        // Wait a bit for connection to be fully established
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to establish database connection:', error);
        return false;
      }
    }
    return database.isConnectionReady();
  }

  // Clean up expired cache entries
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
      }
    }
  }

  // Fallback rate limiting using in-memory store
  checkRateLimitFallback(sessionId, ip, userToken = null, userInfo = null) {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = today.getTime() + 24 * 60 * 60 * 1000;
    const nextHour = now + 60 * 60 * 1000;

    const fingerprint = this.generateFingerprint(userInfo);
    const identifiers = [
      { key: ip, type: 'ip' },
      { key: userToken, type: 'userToken' },
      { key: fingerprint, type: 'fingerprint' },
    ].filter(id => id.key);

    let maxDailyCount = 0;
    let maxHourlyCount = 0;
    let exceededIdentifier = null;
    let exceededLimit = null;

    for (const identifier of identifiers) {
      const key = `${identifier.type}:${identifier.key}`;
      let data = this.fallbackStore.get(key);

      if (!data) {
        data = {
          dailyCount: 0,
          hourlyCount: 0,
          dailyResetTime: tomorrow,
          hourlyResetTime: nextHour,
        };
        this.fallbackStore.set(key, data);
      }

      // Reset counts if needed
      if (data.dailyResetTime < now) {
        data.dailyCount = 0;
        data.dailyResetTime = tomorrow;
      }
      if (data.hourlyResetTime < now) {
        data.hourlyCount = 0;
        data.hourlyResetTime = nextHour;
      }

      if (data.dailyCount > maxDailyCount) {
        maxDailyCount = data.dailyCount;
      }
      if (data.hourlyCount > maxHourlyCount) {
        maxHourlyCount = data.hourlyCount;
      }

      if (data.dailyCount >= this.MAX_MESSAGES_PER_DAY) {
        exceededIdentifier = identifier;
        exceededLimit = 'daily';
        break;
      }
      if (data.hourlyCount >= this.MAX_MESSAGES_PER_HOUR) {
        exceededIdentifier = identifier;
        exceededLimit = 'hourly';
        break;
      }
    }

    if (exceededIdentifier) {
      return {
        allowed: false,
        reason: `${exceededLimit}_limit`,
        dailyCount: maxDailyCount,
        hourlyCount: maxHourlyCount,
        dailyResetTime: tomorrow,
        hourlyResetTime: nextHour,
        exceededBy: exceededIdentifier.type,
      };
    }

    return {
      allowed: true,
      dailyCount: maxDailyCount,
      hourlyCount: maxHourlyCount,
      dailyResetTime: tomorrow,
      hourlyResetTime: nextHour,
    };
  }

  // Fallback increment using in-memory store
  incrementCountFallback(sessionId, ip, userToken = null, userInfo = null) {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = today.getTime() + 24 * 60 * 60 * 1000;
    const nextHour = now + 60 * 60 * 1000;

    const fingerprint = this.generateFingerprint(userInfo);
    const identifiers = [
      { key: ip, type: 'ip' },
      { key: userToken, type: 'userToken' },
      { key: fingerprint, type: 'fingerprint' },
    ].filter(id => id.key);

    let maxDailyCount = 0;
    let maxHourlyCount = 0;

    for (const identifier of identifiers) {
      const key = `${identifier.type}:${identifier.key}`;
      let data = this.fallbackStore.get(key);

      if (!data) {
        data = {
          dailyCount: 0,
          hourlyCount: 0,
          dailyResetTime: tomorrow,
          hourlyResetTime: nextHour,
        };
      }

      // Reset counts if needed
      if (data.dailyResetTime < now) {
        data.dailyCount = 0;
        data.dailyResetTime = tomorrow;
      }
      if (data.hourlyResetTime < now) {
        data.hourlyCount = 0;
        data.hourlyResetTime = nextHour;
      }

      data.dailyCount++;
      data.hourlyCount++;
      this.fallbackStore.set(key, data);

      if (data.dailyCount > maxDailyCount) {
        maxDailyCount = data.dailyCount;
      }
      if (data.hourlyCount > maxHourlyCount) {
        maxHourlyCount = data.hourlyCount;
      }
    }

    return {
      dailyCount: maxDailyCount,
      hourlyCount: maxHourlyCount,
    };
  }

  // Generate session ID based on IP and user agent
  generateSessionId(ip, userAgent) {
    const crypto = require('crypto');
    return crypto
      .createHash('md5')
      .update(ip + userAgent + Date.now().toString())
      .digest('hex');
  }

  // Generate browser fingerprint for additional tracking
  generateFingerprint(userInfo) {
    if (!userInfo) {
      return null;
    }

    const crypto = require('crypto');
    const fingerprint = crypto
      .createHash('md5')
      .update(
        (userInfo.browser?.name || '') +
          (userInfo.browser?.version || '') +
          (userInfo.browser?.os || '') +
          (userInfo.geolocation?.country || '') +
          (userInfo.geolocation?.city || '')
      )
      .digest('hex');

    return fingerprint;
  }

  // Check if request is within rate limits (multi-layered)
  async checkRateLimit(sessionId, ip, userToken = null, userInfo = null) {
    // Check cache first
    const cacheKey = `check:${ip}:${userToken || 'null'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log('🚀 [RATE_LIMIT] Using cached result');
      return cached.result;
    }

    // Ensure database connection is ready
    const dbReady = await this.ensureDatabaseConnection();
    if (!dbReady) {
      console.warn('Database not available, using fallback rate limiting');
      return this.checkRateLimitFallback(sessionId, ip, userToken, userInfo);
    }

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

    // Generate fingerprint for additional tracking
    const fingerprint = this.generateFingerprint(userInfo);

    // Check rate limits across multiple identifiers
    const identifiers = [
      { key: ip, type: 'ip' },
      { key: userToken, type: 'userToken' },
      { key: fingerprint, type: 'fingerprint' },
    ].filter(id => id.key); // Only check valid identifiers

    let maxDailyCount = 0;
    let maxHourlyCount = 0;
    let exceededIdentifier = null;
    let exceededLimit = null;

    // Optimize: Use bulk operations to reduce database calls
    try {
      // First, get all existing rate limits in one query
      const existingLimits = await RateLimit.find({
        $or: identifiers.map(id => ({
          identifier: id.key,
          type: id.type,
        })),
      });

      // Create a map for quick lookup
      const limitsMap = new Map();
      existingLimits.forEach(limit => {
        limitsMap.set(`${limit.type}:${limit.identifier}`, limit);
      });

      // Process each identifier
      for (const identifier of identifiers) {
        const key = `${identifier.type}:${identifier.key}`;
        let result = limitsMap.get(key);

        if (!result) {
          // Create new rate limit record
          result = new RateLimit({
            identifier: identifier.key,
            type: identifier.type,
            dailyCount: 0,
            hourlyCount: 0,
            dailyResetTime: tomorrow,
            hourlyResetTime: nextHour,
          });
          await result.save();
        } else {
          // Check if we need to reset counts
          const shouldResetDaily = result.dailyResetTime < now;
          const shouldResetHourly = result.hourlyResetTime < now;

          if (shouldResetDaily || shouldResetHourly) {
            const updateData = {};
            if (shouldResetDaily) {
              updateData.dailyCount = 0;
              updateData.dailyResetTime = tomorrow;
            }
            if (shouldResetHourly) {
              updateData.hourlyCount = 0;
              updateData.hourlyResetTime = nextHour;
            }

            await RateLimit.findByIdAndUpdate(result._id, updateData);
            result.dailyCount = shouldResetDaily ? 0 : result.dailyCount;
            result.hourlyCount = shouldResetHourly ? 0 : result.hourlyCount;
          }
        }

        // Track the highest counts across all identifiers
        if (result.dailyCount > maxDailyCount) {
          maxDailyCount = result.dailyCount;
        }
        if (result.hourlyCount > maxHourlyCount) {
          maxHourlyCount = result.hourlyCount;
        }

        // Check if this identifier has exceeded any limit
        if (result.dailyCount >= this.MAX_MESSAGES_PER_DAY) {
          exceededIdentifier = identifier;
          exceededLimit = 'daily';
          break;
        }
        if (result.hourlyCount >= this.MAX_MESSAGES_PER_HOUR) {
          exceededIdentifier = identifier;
          exceededLimit = 'hourly';
          break;
        }
      }
    } catch (error) {
      console.error('Bulk rate limit check error:', error);
      // Fall back to individual operations
      for (const identifier of identifiers) {
        try {
          const result = await RateLimit.findOneAndUpdate(
            {
              identifier: identifier.key,
              type: identifier.type,
            },
            {
              $setOnInsert: {
                identifier: identifier.key,
                type: identifier.type,
                dailyCount: 0,
                hourlyCount: 0,
                dailyResetTime: tomorrow,
                hourlyResetTime: nextHour,
              },
            },
            {
              upsert: true,
              new: true,
            }
          );

          const shouldResetDaily = result.dailyResetTime < now;
          const shouldResetHourly = result.hourlyResetTime < now;

          if (shouldResetDaily || shouldResetHourly) {
            const updateData = {};
            if (shouldResetDaily) {
              updateData.dailyCount = 0;
              updateData.dailyResetTime = tomorrow;
            }
            if (shouldResetHourly) {
              updateData.hourlyCount = 0;
              updateData.hourlyResetTime = nextHour;
            }

            await RateLimit.findByIdAndUpdate(result._id, updateData);
            result.dailyCount = shouldResetDaily ? 0 : result.dailyCount;
            result.hourlyCount = shouldResetHourly ? 0 : result.hourlyCount;
          }

          if (result.dailyCount > maxDailyCount) {
            maxDailyCount = result.dailyCount;
          }
          if (result.hourlyCount > maxHourlyCount) {
            maxHourlyCount = result.hourlyCount;
          }

          if (result.dailyCount >= this.MAX_MESSAGES_PER_DAY) {
            exceededIdentifier = identifier;
            exceededLimit = 'daily';
            break;
          }
          if (result.hourlyCount >= this.MAX_MESSAGES_PER_HOUR) {
            exceededIdentifier = identifier;
            exceededLimit = 'hourly';
            break;
          }
        } catch (individualError) {
          console.error('Individual rate limit check error:', individualError);
          continue;
        }
      }
    }

    let result;
    if (exceededIdentifier) {
      console.log(`Rate limit exceeded: ${exceededLimit} limit by ${exceededIdentifier.type}`);
      result = {
        allowed: false,
        reason: `${exceededLimit}_limit`,
        dailyCount: maxDailyCount,
        hourlyCount: maxHourlyCount,
        dailyResetTime: tomorrow.getTime(),
        hourlyResetTime: nextHour.getTime(),
        exceededBy: exceededIdentifier.type,
      };
    } else {
      result = {
        allowed: true,
        dailyCount: maxDailyCount,
        hourlyCount: maxHourlyCount,
        dailyResetTime: tomorrow.getTime(),
        hourlyResetTime: nextHour.getTime(),
      };
    }

    // Cache the result
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });

    // Clean up old cache entries
    this.cleanupCache();

    return result;
  }

  // Increment message count across all identifiers
  async incrementCount(sessionId, ip, userToken = null, userInfo = null) {
    // Invalidate cache when counts are incremented
    const cacheKey = `check:${ip}:${userToken || 'null'}`;
    this.cache.delete(cacheKey);

    // Ensure database connection is ready
    const dbReady = await this.ensureDatabaseConnection();
    if (!dbReady) {
      console.warn('Database not available, using fallback rate limiting');
      return this.incrementCountFallback(sessionId, ip, userToken, userInfo);
    }

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

    const fingerprint = this.generateFingerprint(userInfo);

    // Increment counts for all valid identifiers
    const identifiers = [
      { key: ip, type: 'ip' },
      { key: userToken, type: 'userToken' },
      { key: fingerprint, type: 'fingerprint' },
    ].filter(id => id.key);

    let maxDailyCount = 0;
    let maxHourlyCount = 0;

    // Optimize: Use bulk operations for incrementing counts
    try {
      // Use bulkWrite for better performance
      const bulkOps = identifiers.map(identifier => ({
        updateOne: {
          filter: {
            identifier: identifier.key,
            type: identifier.type,
          },
          update: {
            $inc: {
              dailyCount: 1,
              hourlyCount: 1,
            },
            $setOnInsert: {
              identifier: identifier.key,
              type: identifier.type,
              dailyResetTime: tomorrow,
              hourlyResetTime: nextHour,
            },
          },
          upsert: true,
        },
      }));

      await RateLimit.bulkWrite(bulkOps);

      // Get updated counts in one query
      const updatedLimits = await RateLimit.find({
        $or: identifiers.map(id => ({
          identifier: id.key,
          type: id.type,
        })),
      });

      // Track the highest counts across all identifiers
      updatedLimits.forEach(result => {
        if (result.dailyCount > maxDailyCount) {
          maxDailyCount = result.dailyCount;
        }
        if (result.hourlyCount > maxHourlyCount) {
          maxHourlyCount = result.hourlyCount;
        }
      });
    } catch (error) {
      console.error('Bulk increment error:', error);
      // Fall back to individual operations
      for (const identifier of identifiers) {
        try {
          const result = await RateLimit.findOneAndUpdate(
            {
              identifier: identifier.key,
              type: identifier.type,
            },
            {
              $inc: {
                dailyCount: 1,
                hourlyCount: 1,
              },
              $setOnInsert: {
                identifier: identifier.key,
                type: identifier.type,
                dailyResetTime: tomorrow,
                hourlyResetTime: nextHour,
              },
            },
            {
              upsert: true,
              new: true,
            }
          );

          if (result.dailyCount > maxDailyCount) {
            maxDailyCount = result.dailyCount;
          }
          if (result.hourlyCount > maxHourlyCount) {
            maxHourlyCount = result.hourlyCount;
          }
        } catch (individualError) {
          console.error('Individual increment error:', individualError);
        }
      }
    }

    return {
      dailyCount: maxDailyCount,
      hourlyCount: maxHourlyCount,
    };
  }

  // Get current counts across all identifiers
  async getCounts(sessionId, ip, userToken = null, userInfo = null) {
    // Ensure database connection is ready
    const dbReady = await this.ensureDatabaseConnection();
    if (!dbReady) {
      console.warn('Database not available, using fallback rate limiting');
      const fallbackResult = this.checkRateLimitFallback(sessionId, ip, userToken, userInfo);
      return {
        dailyCount: fallbackResult.dailyCount,
        hourlyCount: fallbackResult.hourlyCount,
        maxDaily: this.MAX_MESSAGES_PER_DAY,
        maxHourly: this.MAX_MESSAGES_PER_HOUR,
      };
    }

    const fingerprint = this.generateFingerprint(userInfo);

    const identifiers = [
      { key: ip, type: 'ip' },
      { key: userToken, type: 'userToken' },
      { key: fingerprint, type: 'fingerprint' },
    ].filter(id => id.key);

    let maxDailyCount = 0;
    let maxHourlyCount = 0;

    for (const identifier of identifiers) {
      try {
        const result = await RateLimit.findOne({
          identifier: identifier.key,
          type: identifier.type,
        });

        if (result) {
          if (result.dailyCount > maxDailyCount) {
            maxDailyCount = result.dailyCount;
          }
          if (result.hourlyCount > maxHourlyCount) {
            maxHourlyCount = result.hourlyCount;
          }
        }
      } catch (error) {
        console.error('Rate limit get counts error:', error);
        // Continue with other identifiers even if one fails
      }
    }

    return {
      dailyCount: maxDailyCount,
      hourlyCount: maxHourlyCount,
      maxDaily: this.MAX_MESSAGES_PER_DAY,
      maxHourly: this.MAX_MESSAGES_PER_HOUR,
    };
  }

  // Get rate limit status for response headers
  async getRateLimitHeaders(sessionId, ip, userToken = null, userInfo = null) {
    const counts = await this.getCounts(sessionId, ip, userToken, userInfo);
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
      'X-RateLimit-Daily-Limit': this.MAX_MESSAGES_PER_DAY,
      'X-RateLimit-Daily-Remaining': Math.max(0, this.MAX_MESSAGES_PER_DAY - counts.dailyCount),
      'X-RateLimit-Daily-Reset': tomorrow.getTime(),
      'X-RateLimit-Hourly-Limit': this.MAX_MESSAGES_PER_HOUR,
      'X-RateLimit-Hourly-Remaining': Math.max(0, this.MAX_MESSAGES_PER_HOUR - counts.hourlyCount),
      'X-RateLimit-Hourly-Reset': nextHour.getTime(),
    };
  }
}

module.exports = new RateLimiter();

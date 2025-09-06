const RateLimit = require('../models/RateLimit');
const database = require('../models/database');

class RateLimiter {
  constructor() {
    // Set rate limits: daily 80
    this.MAX_MESSAGES_PER_DAY = 80;
  }

  // Simple rate limit check - just increment and check in one operation
  async checkRateLimit(sessionId, ip) {
    try {
      await database.waitForConnection();

      const now = new Date();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Simple: just use IP for rate limiting
      console.time('RateLimit.findOneAndUpdate');
      const result = await RateLimit.findOneAndUpdate(
        { identifier: ip, type: 'ip' },
        {
          $inc: { dailyCount: 1 },
          $setOnInsert: {
            identifier: ip,
            type: 'ip',
            dailyResetTime: tomorrow,
          },
        },
        { upsert: true, new: true }
      );
      console.timeEnd('RateLimit.findOneAndUpdate');
      // Check if we need to reset counts
      if (result.dailyResetTime < now) {
        await RateLimit.findByIdAndUpdate(result._id, {
          dailyCount: 1,
          dailyResetTime: tomorrow,
        });
        result.dailyCount = 1;
        result.dailyResetTime = tomorrow;
      }

      // Check limits
      if (result.dailyCount > this.MAX_MESSAGES_PER_DAY) {
        return {
          allowed: false,
          reason: 'daily_limit',
          dailyCount: result.dailyCount,
          dailyResetTime: tomorrow.getTime(),
          exceededBy: 'ip',
        };
      }

      return {
        allowed: true,
        dailyCount: result.dailyCount,
        dailyResetTime: tomorrow.getTime(),
      };
    } catch (error) {
      console.error('Rate limit error:', error);
      // Allow request on error
      return {
        allowed: true,
        dailyCount: 1,
        dailyResetTime: Date.now() + 24 * 60 * 60 * 1000,
      };
    }
  }

  // No separate increment - it's done in checkRateLimit
  async incrementCount(sessionId, ip) {
    // This is now handled in checkRateLimit, so just return the current counts
    return this.getCounts(sessionId, ip);
  }

  // Simple get counts
  async getCounts(sessionId, ip) {
    try {
      await database.waitForConnection();

      const result = await RateLimit.findOne({
        identifier: ip,
        type: 'ip',
      });

      if (result) {
        return {
          dailyCount: result.dailyCount,
          maxDaily: this.MAX_MESSAGES_PER_DAY,
        };
      }

      return {
        dailyCount: 0,
        maxDaily: this.MAX_MESSAGES_PER_DAY,
      };
    } catch (error) {
      console.error('Get counts error:', error);
      return {
        dailyCount: 0,
        maxDaily: this.MAX_MESSAGES_PER_DAY,
      };
    }
  }

  // Generate session ID
  generateSessionId(ip, userAgent) {
    const crypto = require('crypto');
    return crypto
      .createHash('md5')
      .update(ip + userAgent + Date.now().toString())
      .digest('hex');
  }

  // Get rate limit headers
  async getRateLimitHeaders(sessionId, ip) {
    const counts = await this.getCounts(sessionId, ip);

    return {
      'X-RateLimit-Daily-Limit': this.MAX_MESSAGES_PER_DAY,
      'X-RateLimit-Daily-Remaining': Math.max(0, this.MAX_MESSAGES_PER_DAY - counts.dailyCount),
      'X-RateLimit-Daily-Used': counts.dailyCount,
    };
  }
}

module.exports = new RateLimiter();

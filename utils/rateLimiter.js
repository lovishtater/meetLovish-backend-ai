// In-memory rate limiting store for daily limits
// In production, you might want to use Redis or a database
const dailyStore = new Map();
const userTokenStore = new Map(); // Track by user token
const ipStore = new Map(); // Track by IP
const fingerprintStore = new Map(); // Track by browser fingerprint

// Clean up old entries every hour
setInterval(
  () => {
    const now = Date.now();

    // Clean up daily stores
    for (const [key, data] of dailyStore.entries()) {
      if (data.resetTime < now) {
        dailyStore.delete(key);
      }
    }

    for (const [key, data] of userTokenStore.entries()) {
      if (data.resetTime < now) {
        userTokenStore.delete(key);
      }
    }

    for (const [key, data] of ipStore.entries()) {
      if (data.resetTime < now) {
        ipStore.delete(key);
      }
    }

    for (const [key, data] of fingerprintStore.entries()) {
      if (data.resetTime < now) {
        fingerprintStore.delete(key);
      }
    }
  },
  60 * 60 * 1000
); // Run every hour

class RateLimiter {
  constructor() {
    // Get daily limit from environment variable, default to 150
    this.MAX_MESSAGES_PER_DAY = parseInt(process.env.DAILY_MESSAGE_LIMIT) || 50;
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
  checkRateLimit(sessionId, ip, userToken = null, userInfo = null) {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const resetTime = today.getTime() + 24 * 60 * 60 * 1000; // Next midnight

    // Generate fingerprint for additional tracking
    const fingerprint = this.generateFingerprint(userInfo);

    // Check daily limits across multiple identifiers
    const identifiers = [
      { key: ip, store: ipStore, type: 'IP' },
      { key: userToken, store: userTokenStore, type: 'User Token' },
      { key: fingerprint, store: fingerprintStore, type: 'Fingerprint' },
    ].filter(id => id.key); // Only check valid identifiers

    let maxDailyCount = 0;
    let exceededIdentifier = null;

    for (const identifier of identifiers) {
      let data = identifier.store.get(identifier.key);
      if (!data) {
        data = {
          messageCount: 0,
          resetTime: resetTime,
        };
        identifier.store.set(identifier.key, data);
      }

      // Reset daily count if it's a new day
      if (data.resetTime < now) {
        data.messageCount = 0;
        data.resetTime = resetTime;
      }

      // Track the highest count across all identifiers
      if (data.messageCount > maxDailyCount) {
        maxDailyCount = data.messageCount;
      }

      // Check if this identifier has exceeded the limit
      if (data.messageCount >= this.MAX_MESSAGES_PER_DAY) {
        exceededIdentifier = identifier;
        break;
      }
    }

    if (exceededIdentifier) {
      console.log('Exceeded identifier:', exceededIdentifier.type);
      return {
        allowed: false,
        reason: 'daily_limit',
        dailyCount: maxDailyCount,
        resetTime: resetTime,
        exceededBy: exceededIdentifier.type,
      };
    }

    return {
      allowed: true,
      dailyCount: maxDailyCount,
      resetTime: resetTime,
    };
  }

  // Increment message count across all identifiers
  incrementCount(sessionId, ip, userToken = null, userInfo = null) {
    const fingerprint = this.generateFingerprint(userInfo);

    // Increment counts for all valid identifiers
    const identifiers = [
      { key: ip, store: ipStore },
      { key: userToken, store: userTokenStore },
      { key: fingerprint, store: fingerprintStore },
    ].filter(id => id.key);

    for (const identifier of identifiers) {
      const data = identifier.store.get(identifier.key);
      if (data) {
        data.messageCount++;
      }
    }

    // Return the highest count across all identifiers
    const counts = identifiers.map(id => id.store.get(id.key)?.messageCount || 0);
    const maxCount = Math.max(...counts, 0);

    return {
      dailyCount: maxCount,
    };
  }

  // Get current counts across all identifiers
  getCounts(sessionId, ip, userToken = null, userInfo = null) {
    const fingerprint = this.generateFingerprint(userInfo);

    const identifiers = [
      { key: ip, store: ipStore },
      { key: userToken, store: userTokenStore },
      { key: fingerprint, store: fingerprintStore },
    ].filter(id => id.key);

    const counts = identifiers.map(id => id.store.get(id.key)?.messageCount || 0);
    const maxCount = Math.max(...counts, 0);

    return {
      dailyCount: maxCount,
      maxDaily: this.MAX_MESSAGES_PER_DAY,
    };
  }

  // Get rate limit status for response headers
  getRateLimitHeaders(sessionId, ip, userToken = null, userInfo = null) {
    const counts = this.getCounts(sessionId, ip, userToken, userInfo);
    const dailyData = ipStore.get(ip);

    return {
      'X-RateLimit-Daily-Limit': this.MAX_MESSAGES_PER_DAY,
      'X-RateLimit-Daily-Remaining': Math.max(0, this.MAX_MESSAGES_PER_DAY - counts.dailyCount),
      'X-RateLimit-Reset': dailyData?.resetTime || 0,
    };
  }
}

module.exports = new RateLimiter();

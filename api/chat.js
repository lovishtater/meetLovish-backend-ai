const express = require('express');
const router = express.Router();
const AIAssistant = require('../lib/openai');
const rateLimiter = require('../utils/rateLimiter');
const { logChatSession } = require('../utils/logger');
const geoip = require('geoip-lite');
const useragent = require('useragent');
const User = require('../models/User');
const database = require('../models/database');

// Lazy-load AI Assistant to avoid startup issues
let aiAssistant = null;
function getAIAssistant() {
  if (!aiAssistant) {
    aiAssistant = new AIAssistant();
  }
  return aiAssistant;
}

// Middleware to extract user info
function getUserInfo(req) {
  const ip =
    req.ip ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : '127.0.0.1');
  const userAgent = req.get('User-Agent') || '';
  const geo = geoip.lookup(ip);
  const agent = useragent.parse(userAgent);

  return {
    ip,
    userAgent,
    geolocation: geo
      ? {
          country: geo.country,
          region: geo.region,
          city: geo.city,
          ll: geo.ll, // latitude, longitude
          timezone: geo.timezone,
        }
      : null,
    browser: {
      name: agent.family,
      version: agent.toVersion(),
      os: agent.os.toString(),
    },
  };
}

// POST /api/chat/init - Initialize a new chat session
router.post('/chat/init', async (req, res) => {
  const startTime = Date.now();
  console.log(`🚀 [INIT] Starting chat init request at ${new Date().toISOString()}`);

  try {
    const { token } = req.body;
    const userInfoStart = Date.now();
    const userInfo = getUserInfo(req);
    console.log(`⏱️ [INIT] User info extraction: ${Date.now() - userInfoStart}ms`);

    // Find or create user by token - wait for database connection
    let user = null;
    try {
      const dbWaitStart = Date.now();
      await database.waitForConnection();
      console.log(`⏱️ [INIT] Database wait: ${Date.now() - dbWaitStart}ms`);

      const userCreateStart = Date.now();
      const userResult = await User.findOrCreateByToken(token, userInfo);
      user = userResult.user;
      console.log(`⏱️ [INIT] User find/create: ${Date.now() - userCreateStart}ms`);
    } catch (dbError) {
      console.error('Database error during user creation:', dbError);
      return res.status(503).json({
        error: 'Database service temporarily unavailable. Please try again in a moment.',
      });
    }

    // Generate new session ID
    const sessionId = rateLimiter.generateSessionId(userInfo.ip, userInfo.userAgent);

    // Add session to user - database connection is already ensured
    if (user) {
      try {
        const sessionAddStart = Date.now();
        await user.addSession(sessionId);
        console.log(`⏱️ [INIT] Session add: ${Date.now() - sessionAddStart}ms`);
      } catch (sessionError) {
        console.error('Error adding session to user:', sessionError);
        return res.status(503).json({
          error: 'Database service temporarily unavailable. Please try again in a moment.',
        });
      }
    }

    // Initialize rate limit tracking
    const rateLimitStart = Date.now();
    const rateLimitResult = await rateLimiter.checkRateLimit(sessionId, userInfo.ip, token, userInfo);
    console.log(`⏱️ [INIT] Rate limit check: ${Date.now() - rateLimitStart}ms`);

    // Get rate limit headers
    const headerStart = Date.now();
    const rateLimitHeaders = await rateLimiter.getRateLimitHeaders(sessionId, userInfo.ip, token, userInfo);
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    console.log(`⏱️ [INIT] Rate limit headers: ${Date.now() - headerStart}ms`);

    // Send response
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [INIT] Total request time: ${totalTime}ms`);

    res.json({
      sessionId,
      userToken: user?.token || null,
      userInfo: {
        geolocation: userInfo.geolocation,
        browser: userInfo.browser,
        name: user?.name || null,
        email: user?.email || null,
      },
      rateLimits: {
        dailyCount: rateLimitResult.dailyCount,
        hourlyCount: rateLimitResult.hourlyCount,
        dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
        hourlyLimit: rateLimiter.MAX_MESSAGES_PER_HOUR,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Chat init endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error. Please try again.',
    });
  }
});

// POST /api/chat - Main chat endpoint
router.post('/chat', async (req, res) => {
  const startTime = Date.now();
  console.log(`🚀 [CHAT] Starting chat request at ${new Date().toISOString()}`);

  try {
    const { message, sessionId, userToken } = req.body;

    // Validate input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Message is required and must be a non-empty string',
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        error: 'Message too long. Maximum 1000 characters allowed.',
      });
    }

    // Get user info
    const userInfoStart = Date.now();
    const userInfo = getUserInfo(req);
    console.log(`⏱️ [CHAT] User info extraction: ${Date.now() - userInfoStart}ms`);

    // Validate session ID
    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID is required',
      });
    }

    const currentSessionId = sessionId;

    // Check rate limits
    const rateLimitStart = Date.now();
    const rateLimitResult = await rateLimiter.checkRateLimit(currentSessionId, userInfo.ip, userToken, userInfo);
    console.log(`⏱️ [CHAT] Rate limit check: ${Date.now() - rateLimitStart}ms`);

    if (!rateLimitResult.allowed) {
      const limitType = rateLimitResult.reason === 'daily_limit' ? 'daily' : 'hourly';
      const limitValue =
        rateLimitResult.reason === 'daily_limit' ? rateLimiter.MAX_MESSAGES_PER_DAY : rateLimiter.MAX_MESSAGES_PER_HOUR;
      const resetTime =
        rateLimitResult.reason === 'daily_limit' ? rateLimitResult.dailyResetTime : rateLimitResult.hourlyResetTime;
      const errorMessage = `${limitType.charAt(0).toUpperCase() + limitType.slice(1)} limit reached. You can send up to ${limitValue} messages per ${limitType}. Please try again later in ${Math.floor((resetTime - Date.now()) / 1000 / 60)} minutes.`;

      return res.status(429).json({
        error: errorMessage,
        reason: rateLimitResult.reason,
        dailyCount: rateLimitResult.dailyCount,
        hourlyCount: rateLimitResult.hourlyCount,
        resetTime: resetTime,
        exceededBy: rateLimitResult.exceededBy,
      });
    }

    // Increment rate limit counters
    const incrementStart = Date.now();
    const counts = await rateLimiter.incrementCount(currentSessionId, userInfo.ip, userToken, userInfo);
    console.log(`⏱️ [CHAT] Rate limit increment: ${Date.now() - incrementStart}ms`);

    // Find user by token if provided - wait for database connection
    let user = null;
    if (userToken) {
      try {
        const dbWaitStart = Date.now();
        await database.waitForConnection();
        console.log(`⏱️ [CHAT] Database wait: ${Date.now() - dbWaitStart}ms`);

        const userFindStart = Date.now();
        user = await User.findByToken(userToken);
        console.log(`⏱️ [CHAT] User find: ${Date.now() - userFindStart}ms`);

        if (user) {
          const sessionUpdateStart = Date.now();
          await user.updateSessionActivity(currentSessionId);
          console.log(`⏱️ [CHAT] Session update: ${Date.now() - sessionUpdateStart}ms`);
        }
      } catch (userError) {
        console.error('Error updating user session:', userError);
        return res.status(503).json({
          error: 'Database service temporarily unavailable. Please try again in a moment.',
        });
      }
    }

    // Store session context for tool calls
    req.sessionId = currentSessionId;
    req.userInfo = userInfo;
    req.user = user;

    // Prepare user context for personalization
    let userContext = null;
    if (user) {
      userContext = {
        name: user.name,
        email: user.email,
        notes: user.notes,
      };
    }

    // Get conversation history for context - database connection is already ensured
    let conversationHistory = [];
    if (user?._id) {
      try {
        const historyStart = Date.now();
        const Chat = require('../models/Chat');
        const historyChats = await Chat.getConversationHistory(user._id, currentSessionId, 10);
        console.log(`⏱️ [CHAT] Conversation history fetch: ${Date.now() - historyStart}ms`);

        // Convert chat history to OpenAI message format
        const convertStart = Date.now();
        conversationHistory = historyChats
          .map(chat => [
            { role: 'user', content: chat.userMessage },
            { role: 'assistant', content: chat.assistantMessage },
          ])
          .flat();
        console.log(`⏱️ [CHAT] History conversion: ${Date.now() - convertStart}ms`);

        console.log(`📚 Loaded ${conversationHistory.length} messages from conversation history`);
      } catch (historyError) {
        console.error('❌ Error loading conversation history:', historyError);
        return res.status(503).json({
          error: 'Database service temporarily unavailable. Please try again in a moment.',
        });
      }
    }

    // Get AI response with conversation history
    const aiStart = Date.now();
    const response = await getAIAssistant().chat(
      message,
      conversationHistory,
      currentSessionId,
      userInfo,
      user?._id,
      userContext
    );
    console.log(`⏱️ [CHAT] AI response generation: ${Date.now() - aiStart}ms`);

    // Extract tool outputs for logging
    const toolOutputs = response.messages.filter(msg => msg.role === 'tool').map(msg => JSON.parse(msg.content));

    // Check if user details were updated in this response
    let updatedUserInfo = {
      name: user?.name || null,
      email: user?.email || null,
    };
    // Check if any tool call updated user details
    const userDetailsUpdated = toolOutputs.some(
      output => output.recorded === 'ok' && output.userId && !output.validationError
    );

    // If user details were updated, fetch the latest user info - database connection is already ensured
    if (userDetailsUpdated && user?._id) {
      try {
        const userUpdateStart = Date.now();
        const updatedUser = await User.findById(user._id);
        console.log(`⏱️ [CHAT] User info update fetch: ${Date.now() - userUpdateStart}ms`);

        if (updatedUser) {
          updatedUserInfo = {
            name: updatedUser.name || null,
            email: updatedUser.email || null,
          };
          console.log(`🔄 Updated user info in response:`, updatedUserInfo);
        }
      } catch (updateError) {
        console.error('❌ Error fetching updated user info:', updateError);
        return res.status(503).json({
          error: 'Database service temporarily unavailable. Please try again in a moment.',
        });
      }
    }

    // Log the chat session
    const logStart = Date.now();
    await logChatSession({
      sessionId: currentSessionId,
      userId: user?._id,
      userMessage: message,
      assistantMessage: response.content,
      toolOutputs,
      messageCount: counts.dailyCount,
    });
    console.log(`⏱️ [CHAT] Chat session logging: ${Date.now() - logStart}ms`);

    // Set rate limit headers
    const headerStart = Date.now();
    const rateLimitHeaders = await rateLimiter.getRateLimitHeaders(currentSessionId, userInfo.ip, userToken, userInfo);
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    console.log(`⏱️ [CHAT] Rate limit headers: ${Date.now() - headerStart}ms`);

    // Send response with updated user info
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [CHAT] Total request time: ${totalTime}ms`);

    res.json({
      message: response.content,
      sessionId: currentSessionId,
      sessionMessages: response.messages,
      userInfo: updatedUserInfo,
      rateLimits: {
        dailyCount: counts.dailyCount,
        hourlyCount: counts.hourlyCount,
        dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
        hourlyLimit: rateLimiter.MAX_MESSAGES_PER_HOUR,
      },
    });
  } catch (error) {
    console.error('Chat endpoint error:', error);

    // Different error responses based on error type
    if (error.message.includes('OpenAI')) {
      res.status(503).json({
        error: 'AI service temporarily unavailable. Please try again in a moment.',
      });
    } else {
      res.status(500).json({
        error: 'Internal server error. Please try again.',
      });
    }
  }
});

// GET /api/chat/status - Get session status and rate limits
router.get('/chat/status', async (req, res) => {
  try {
    const { sessionId } = req.query;
    const userInfo = getUserInfo(req);

    if (!sessionId) {
      return res.json({
        sessionId: null,
        rateLimits: {
          dailyCount: 0,
          hourlyCount: 0,
          dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
          hourlyLimit: rateLimiter.MAX_MESSAGES_PER_HOUR,
        },
      });
    }

    const counts = await rateLimiter.getCounts(sessionId, userInfo.ip, null, userInfo);
    const rateLimitHeaders = await rateLimiter.getRateLimitHeaders(sessionId, userInfo.ip, null, userInfo);

    // Set rate limit headers
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    res.json({
      sessionId,
      rateLimits: {
        dailyCount: counts.dailyCount,
        hourlyCount: counts.hourlyCount,
        dailyLimit: counts.maxDaily,
        hourlyLimit: counts.maxHourly,
        dailyRemaining: Math.max(0, counts.maxDaily - counts.dailyCount),
        hourlyRemaining: Math.max(0, counts.maxHourly - counts.hourlyCount),
      },
    });
  } catch (error) {
    console.error('Chat status endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

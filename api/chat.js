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
    const rateLimitResult = await rateLimiter.checkRateLimit(sessionId, userInfo.ip);
    console.log(`⏱️ [INIT] Rate limit check: ${Date.now() - rateLimitStart}ms`);

    // Get rate limit headers
    const headerStart = Date.now();
    const rateLimitHeaders = await rateLimiter.getRateLimitHeaders(sessionId, userInfo.ip);
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
        dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
        dailyRemaining: Math.max(0, rateLimiter.MAX_MESSAGES_PER_DAY - rateLimitResult.dailyCount),
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

    // Check rate limits (this also increments the counter)
    const rateLimitStart = Date.now();
    const rateLimitResult = await rateLimiter.checkRateLimit(currentSessionId, userInfo.ip);
    console.log(`⏱️ [CHAT] Rate limit check & increment: ${Date.now() - rateLimitStart}ms`);

    if (!rateLimitResult.allowed) {
      const resetTime = rateLimitResult.dailyResetTime;
      const errorMessage = `Daily limit reached. You can send up to ${rateLimiter.MAX_MESSAGES_PER_DAY} messages per day. Please try again later in ${Math.floor((resetTime - Date.now()) / 1000 / 60)} minutes.`;

      return res.status(429).json({
        error: errorMessage,
        reason: rateLimitResult.reason,
        dailyCount: rateLimitResult.dailyCount,
        resetTime: resetTime,
        exceededBy: rateLimitResult.exceededBy,
      });
    }

    const counts = { dailyCount: rateLimitResult.dailyCount };

    // Parallelize database operations
    let user = null;
    let conversationHistory = [];

    if (userToken) {
      try {
        const dbWaitStart = Date.now();
        await database.waitForConnection();
        console.log(`⏱️ [CHAT] Database wait: ${Date.now() - dbWaitStart}ms`);

        const parallelStart = Date.now();

        // Run user operations in parallel
        const userPromise = User.findByToken(userToken);

        // Start both operations
        const [foundUser] = await Promise.all([userPromise]);
        user = foundUser;

        console.log(`⏱️ [CHAT] Parallel user operations: ${Date.now() - parallelStart}ms`);

        // Get conversation history and update session in parallel (if user exists)
        if (user) {
          const parallelUserStart = Date.now();
          const Chat = require('../models/Chat');

          const [historyChats] = await Promise.all([
            Chat.getConversationHistory(user._id, currentSessionId, 10),
            user.updateSessionActivity(currentSessionId),
          ]);

          console.log(`⏱️ [CHAT] Parallel user data operations: ${Date.now() - parallelUserStart}ms`);

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
        }
      } catch (userError) {
        console.error('Error with user operations:', userError);
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

    // Parallelize final operations
    const finalOpsStart = Date.now();

    const promises = [
      // Always log the chat session
      logChatSession({
        sessionId: currentSessionId,
        userId: user?._id,
        userMessage: message,
        assistantMessage: response.content,
        toolOutputs,
        messageCount: counts.dailyCount,
      }),

      // Always get rate limit headers
      rateLimiter.getRateLimitHeaders(currentSessionId, userInfo.ip),
    ];

    // Add user update promise if needed
    if (userDetailsUpdated && user?._id) {
      promises.push(User.findById(user._id));
    }

    try {
      const results = await Promise.all(promises);

      // Extract results
      const rateLimitHeaders = results[1];
      const updatedUser = userDetailsUpdated && user?._id ? results[2] : null;

      console.log(`⏱️ [CHAT] Parallel final operations: ${Date.now() - finalOpsStart}ms`);

      // Update user info if user was updated
      if (updatedUser) {
        updatedUserInfo = {
          name: updatedUser.name || null,
          email: updatedUser.email || null,
        };
        console.log(`🔄 Updated user info in response:`, updatedUserInfo);
      }

      // Set rate limit headers
      Object.entries(rateLimitHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    } catch (finalError) {
      console.error('❌ Error in final operations:', finalError);
      // Continue with response even if final operations fail
    }

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
        dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
        dailyRemaining: Math.max(0, rateLimiter.MAX_MESSAGES_PER_DAY - counts.dailyCount),
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

// POST /api/chat/stream - Streaming chat endpoint (Server-Sent Events)
router.post('/chat/stream', async (req, res) => {
  const startTime = Date.now();

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { message, sessionId, userToken } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      sendEvent({ type: 'error', message: 'Message is required' });
      return res.end();
    }

    if (message.length > 1000) {
      sendEvent({ type: 'error', message: 'Message too long. Maximum 1000 characters.' });
      return res.end();
    }

    if (!sessionId) {
      sendEvent({ type: 'error', message: 'Session ID is required' });
      return res.end();
    }

    const userInfo = getUserInfo(req);

    const rateLimitResult = await rateLimiter.checkRateLimit(sessionId, userInfo.ip);
    if (!rateLimitResult.allowed) {
      const minutes = Math.floor((rateLimitResult.dailyResetTime - Date.now()) / 60000);
      sendEvent({ type: 'error', message: `Daily limit reached. Try again in ${minutes} minutes.` });
      return res.end();
    }

    let user = null;
    let conversationHistory = [];

    if (userToken) {
      try {
        await database.waitForConnection();
        user = await User.findByToken(userToken);

        if (user) {
          const Chat = require('../models/Chat');
          const [historyChats] = await Promise.all([
            Chat.getConversationHistory(user._id, sessionId, 10),
            user.updateSessionActivity(sessionId),
          ]);
          conversationHistory = historyChats
            .map(chat => [
              { role: 'user', content: chat.userMessage },
              { role: 'assistant', content: chat.assistantMessage },
            ])
            .flat();
        }
      } catch (err) {
        console.error('DB error in stream endpoint:', err);
      }
    }

    const userContext = user ? { name: user.name, email: user.email, notes: user.notes } : null;

    const response = await getAIAssistant().chatStream(
      message,
      conversationHistory,
      sessionId,
      userInfo,
      user?._id,
      userContext,
      chunk => sendEvent(chunk)
    );

    // Log chat and get updated user in parallel
    const toolOutputs = response.messages.filter(msg => msg.role === 'tool').map(msg => JSON.parse(msg.content));
    const { logChatSession } = require('../utils/logger');

    const userDetailsUpdated = toolOutputs.some(o => o.recorded === 'ok' && o.userId && !o.validationError);
    const promises = [
      logChatSession({
        sessionId,
        userId: user?._id,
        userMessage: message,
        assistantMessage: response.content,
        toolOutputs,
        messageCount: rateLimitResult.dailyCount,
      }),
    ];
    if (userDetailsUpdated && user?._id) {
      promises.push(User.findById(user._id));
    }

    const results = await Promise.all(promises);
    const updatedUser = userDetailsUpdated && user?._id ? results[1] : null;

    sendEvent({
      type: 'done',
      userInfo: {
        name: updatedUser?.name || user?.name || null,
        email: updatedUser?.email || user?.email || null,
      },
      rateLimits: {
        dailyCount: rateLimitResult.dailyCount,
        dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
        dailyRemaining: Math.max(0, rateLimiter.MAX_MESSAGES_PER_DAY - rateLimitResult.dailyCount),
      },
    });

    console.log(`🏁 [STREAM] Total: ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('Stream endpoint error:', error);
    sendEvent({ type: 'error', message: 'Something went wrong. Please try again.' });
  }

  res.end();
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
          dailyLimit: rateLimiter.MAX_MESSAGES_PER_DAY,
          dailyRemaining: rateLimiter.MAX_MESSAGES_PER_DAY,
        },
      });
    }

    const counts = await rateLimiter.getCounts(sessionId, userInfo.ip);
    const rateLimitHeaders = await rateLimiter.getRateLimitHeaders(sessionId, userInfo.ip);

    // Set rate limit headers
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    res.json({
      sessionId,
      rateLimits: {
        dailyCount: counts.dailyCount,
        dailyLimit: counts.maxDaily,
        dailyRemaining: Math.max(0, counts.maxDaily - counts.dailyCount),
      },
    });
  } catch (error) {
    console.error('Chat status endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

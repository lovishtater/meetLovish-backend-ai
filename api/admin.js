const express = require('express');
const router = express.Router();
const { getRecentChats, getRecentToolCalls, getAnalytics } = require('../utils/logger');
const User = require('../models/User');
const Chat = require('../models/Chat');
const ToolCall = require('../models/ToolCall');
const database = require('../models/database');

// Secret-based authentication middleware
function requireSecret(req, res, next) {
  const providedSecret = req.query.secret || req.headers['x-admin-secret'];
  const adminSecret = process.env.ADMIN_SECRET || 'your-secret-key-here';

  if (!providedSecret || providedSecret !== adminSecret) {
    return res.status(403).json({
      error: 'Forbidden. Valid admin secret required.',
      hint: 'Provide secret as query parameter: ?secret=YOUR_SECRET or X-Admin-Secret header',
    });
  }

  next();
}

// GET /api/admin/chats - View recent chat sessions (protected)
router.get('/chats', requireSecret, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const maxLimit = 200; // Prevent excessive data requests

    const actualLimit = Math.min(limit, maxLimit);
    const chats = await getRecentChats(actualLimit);

    res.json({
      chats,
      total: chats.length,
      limit: actualLimit,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin chats endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/tools - View recent tool calls (protected)
router.get('/tools', requireSecret, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const maxLimit = 200;

    const actualLimit = Math.min(limit, maxLimit);
    const tools = await getRecentToolCalls(actualLimit);

    res.json({
      tools,
      total: tools.length,
      limit: actualLimit,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin tools endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/analytics - View analytics data (protected)
router.get('/analytics', requireSecret, async (req, res) => {
  try {
    const analytics = await getAnalytics();

    if (!analytics) {
      return res.status(500).json({ error: 'Failed to generate analytics' });
    }

    res.json({
      analytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin analytics endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users - View comprehensive user data with sessions, chats, and tool calls (protected)
router.get('/users', requireSecret, async (req, res) => {
  console.log('Admin users endpoint called');
  try {
    if (!database.isConnectionReady()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const limit = parseInt(req.query.limit) || 50;
    const maxLimit = 200;
    const actualLimit = Math.min(limit, maxLimit);

    // Aggregation pipeline to get comprehensive user data
    const usersWithData = await User.aggregate([
      // Stage 1: Get all users
      {
        $lookup: {
          from: 'chats',
          localField: '_id',
          foreignField: 'userId',
          as: 'chats',
        },
      },
      {
        $lookup: {
          from: 'toolcalls',
          localField: '_id',
          foreignField: 'userId',
          as: 'toolCalls',
        },
      },
      // Stage 2: Group chats by session properly
      {
        $addFields: {
          sessions: {
            $map: {
              input: {
                $setUnion: '$chats.sessionId',
              },
              as: 'sessionId',
              in: {
                sessionId: '$$sessionId',
                chats: {
                  $filter: {
                    input: '$chats',
                    cond: { $eq: ['$$this.sessionId', '$$sessionId'] },
                  },
                },
                toolCalls: {
                  $filter: {
                    input: '$toolCalls',
                    cond: { $eq: ['$$this.sessionId', '$$sessionId'] },
                  },
                },
              },
            },
          },
        },
      },
      // Stage 3: Add session statistics
      {
        $addFields: {
          sessions: {
            $map: {
              input: '$sessions',
              as: 'session',
              in: {
                sessionId: '$$session.sessionId',
                totalChats: { $size: '$$session.chats' },
                totalToolCalls: { $size: '$$session.toolCalls' },
                firstChat: { $min: '$$session.chats.timestamp' },
                lastChat: { $max: '$$session.chats.timestamp' },
                chats: '$$session.chats',
                toolCalls: '$$session.toolCalls',
              },
            },
          },
        },
      },
      // Stage 4: Calculate user statistics
      {
        $addFields: {
          totalSessions: { $size: '$sessions' },
          totalChats: { $size: '$chats' },
          totalToolCalls: { $size: '$toolCalls' },
          mostRecentActivity: {
            $max: ['$lastActivity', { $max: '$chats.timestamp' }, { $max: '$toolCalls.timestamp' }],
          },
          // Find the most recent chat across all sessions
          mostRecentChat: {
            $reduce: {
              input: '$chats',
              initialValue: null,
              in: {
                $cond: {
                  if: {
                    $or: [{ $eq: ['$$value', null] }, { $gt: ['$$this.timestamp', '$$value.timestamp'] }],
                  },
                  then: '$$this',
                  else: '$$value',
                },
              },
            },
          },
        },
      },
      // Stage 5: Sort by most recent activity
      {
        $sort: { mostRecentActivity: -1 },
      },
      // Stage 6: Limit results
      {
        $limit: actualLimit,
      },
      // Stage 7: Project final structure
      {
        $project: {
          _id: 1,
          email: 1,
          name: 1,
          notes: 1,
          status: 1,
          totalMessages: 1,
          lastActivity: 1,
          userInfo: 1,
          sessions: 1,
          totalSessions: 1,
          totalChats: 1,
          totalToolCalls: 1,
          mostRecentActivity: 1,
          mostRecentChat: 1,
          tags: 1,
        },
      },
    ]);

    const response = {
      users: usersWithData.map(user => ({
        id: user._id,
        email: user.email,
        name: user.name,
        notes: user.notes || '',
        status: user.status,
        totalMessages: user.totalMessages,
        lastActivity: user.lastActivity,
        mostRecentActivity: user.mostRecentActivity,
        userInfo: {
          geolocation: user.userInfo?.geolocation,
          browser: user.userInfo?.browser,
          firstSeenIP: user.userInfo?.firstSeenIP,
          lastSeenIP: user.userInfo?.lastSeenIP,
        },
        sessions: user.sessions.map(session => ({
          sessionId: session.sessionId,
          totalChats: session.totalChats,
          totalToolCalls: session.toolCalls.length,
          firstChat: session.firstChat,
          lastChat: session.lastChat,
          chats: session.chats.map(chat => ({
            id: chat._id,
            userMessage: chat.userMessage,
            assistantMessage: chat.assistantMessage,
            toolOutputs: chat.toolOutputs,
            messageCount: chat.messageCount,
            timestamp: chat.timestamp,
          })),
          toolCalls: session.toolCalls.map(tool => ({
            id: tool._id,
            type: tool.type,
            data: tool.data,
            timestamp: tool.timestamp,
            result: tool.result,
          })),
        })),
        statistics: {
          totalSessions: user.totalSessions,
          totalChats: user.totalChats,
          totalToolCalls: user.totalToolCalls,
        },
        mostRecentChat: user.mostRecentChat
          ? {
              id: user.mostRecentChat._id,
              sessionId: user.mostRecentChat.sessionId,
              userMessage: user.mostRecentChat.userMessage,
              assistantMessage: user.mostRecentChat.assistantMessage,
              timestamp: user.mostRecentChat.timestamp,
            }
          : null,
        tags: user.tags || [],
      })),
      total: usersWithData.length,
      limit: actualLimit,
      timestamp: new Date().toISOString(),
    };
    res.json(response);
  } catch (error) {
    console.error('Admin users endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/status - View system status (protected)
router.get('/status', requireSecret, async (req, res) => {
  try {
    const dbStatus = database.getConnectionStatus();

    res.json({
      database: dbStatus,
      server: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
        memoryUsage: process.memoryUsage(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin status endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/sessions/:sessionId - Get chat history for a specific session (protected)
router.get('/sessions/:sessionId', requireSecret, async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!database.isConnectionReady()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const chats = await Chat.getChatsBySession(sessionId);
    const tools = await ToolCall.getToolCallsBySession(sessionId);

    res.json({
      sessionId,
      chats: chats.map(chat => ({
        id: chat._id,
        userMessage: chat.userMessage,
        assistantMessage: chat.assistantMessage,
        toolOutputs: chat.toolOutputs,
        timestamp: chat.timestamp,
        messageCount: chat.messageCount,
      })),
      tools: tools.map(tool => ({
        id: tool._id,
        type: tool.type,
        data: tool.data,
        timestamp: tool.timestamp,
        result: tool.result,
      })),
      totalMessages: chats.length,
      totalTools: tools.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin session endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/search - Search chats and users (protected)
router.get('/search', requireSecret, async (req, res) => {
  try {
    const { q: query, type = 'all', limit = 20 } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    if (!database.isConnectionReady()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const searchResults = {};

    if (type === 'all' || type === 'chats') {
      const chatResults = await Chat.find({
        $or: [
          { userMessage: { $regex: query, $options: 'i' } },
          { assistantMessage: { $regex: query, $options: 'i' } },
        ],
      })
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .lean();

      searchResults.chats = chatResults.map(chat => ({
        id: chat._id,
        sessionId: chat.sessionId,
        userMessage: chat.userMessage,
        assistantMessage: chat.assistantMessage,
        timestamp: chat.timestamp,
      }));
    }

    if (type === 'all' || type === 'users') {
      const userResults = await User.find({
        $or: [
          { email: { $regex: query, $options: 'i' } },
          { name: { $regex: query, $options: 'i' } },
          { notes: { $regex: query, $options: 'i' } },
        ],
      })
        .sort({ lastInteraction: -1 })
        .limit(parseInt(limit))
        .lean();

      searchResults.users = userResults.map(user => ({
        id: user._id,
        email: user.email,
        name: user.name,
        totalInteractions: user.totalInteractions,
        lastInteraction: user.lastInteraction,
      }));
    }

    res.json({
      query,
      type,
      results: searchResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin search endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/dashboard - Dashboard data for frontend (protected)
router.get('/dashboard', requireSecret, async (req, res) => {
  try {
    const [analytics, recentChats, recentTools, recentUsers] = await Promise.all([
      getAnalytics(),
      getRecentChats(10),
      getRecentToolCalls(10),
      database.isConnectionReady() ? User.getRecentUsers(10) : [],
    ]);

    res.json({
      analytics,
      recentChats: recentChats.map(chat => ({
        id: chat._id,
        sessionId: chat.sessionId,
        userMessage: chat.userMessage,
        assistantMessage: chat.assistantMessage,
        toolOutputs: chat.toolOutputs,
        timestamp: chat.timestamp,
        userInfo: {
          geolocation: chat.userInfo?.geolocation,
          browser: chat.userInfo?.browser,
        },
      })),
      recentTools: recentTools.map(tool => ({
        id: tool._id,
        type: tool.type,
        data: tool.data,
        timestamp: tool.timestamp,
        result: tool.result,
        userInfo: {
          geolocation: tool.userInfo?.geolocation,
        },
      })),
      recentUsers: recentUsers.map(user => ({
        id: user._id,
        email: user.email,
        name: user.name,
        totalInteractions: user.totalInteractions,
        lastInteraction: user.lastInteraction,
        status: user.status,
        geolocation: user.userInfo?.geolocation,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

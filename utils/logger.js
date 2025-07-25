const Chat = require('../models/Chat');
const ToolCall = require('../models/ToolCall');
const User = require('../models/User');
const database = require('../models/database');

// Log a chat session to MongoDB
async function logChatSession(sessionData) {
  try {
    // Check if database is connected
    if (!database.isConnectionReady()) {
      console.warn('⚠️ Database not ready, skipping chat log');
      return;
    }

    const chatEntry = new Chat({
      sessionId: sessionData.sessionId,
      userId: sessionData.userId,
      userMessage: sessionData.userMessage,
      assistantMessage: sessionData.assistantMessage,
      toolOutputs: sessionData.toolOutputs || [],
      messageCount: sessionData.messageCount || 1,
      timestamp: new Date(),
    });

    await chatEntry.save();
  } catch (error) {
    console.error('❌ Error logging chat session to MongoDB:', error);
    // In production, you might want to fall back to file logging or queue for retry
  }
}

// Log tool calls to MongoDB
async function logToolCall(toolData, sessionId, userInfo, result = {}, userId = null) {
  try {
    // Check if database is connected
    if (!database.isConnectionReady()) {
      console.warn('⚠️ Database not ready, skipping tool call log');
      return;
    }

    const toolEntry = new ToolCall({
      type: toolData.type,
      data: {
        email: toolData.email,
        name: toolData.name,
        notes: toolData.notes,
        question: toolData.question,
      },
      sessionId,
      userId,
      userInfo: {
        ip: userInfo?.ip,
        userAgent: userInfo?.userAgent,
        geolocation: userInfo?.geolocation,
      },
      result: {
        status: result.status || 'success',
        message: result.message || 'Tool executed successfully',
        processingTime: result.processingTime || 0,
      },
      timestamp: new Date(),
    });

    await toolEntry.save();

    return toolEntry;
  } catch (error) {
    console.error('❌ Error logging tool call to MongoDB:', error);
    return null;
  }
}

// Get recent chat sessions from MongoDB
async function getRecentChats(limit = 50) {
  try {
    if (!database.isConnectionReady()) {
      console.warn('⚠️ Database not ready, returning empty chats');
      return [];
    }

    return await Chat.getRecentChats(limit);
  } catch (error) {
    console.error('❌ Error fetching recent chats:', error);
    return [];
  }
}

// Get recent tool calls from MongoDB
async function getRecentToolCalls(limit = 50) {
  try {
    if (!database.isConnectionReady()) {
      console.warn('⚠️ Database not ready, returning empty tool calls');
      return [];
    }

    return await ToolCall.getRecentToolCalls(limit);
  } catch (error) {
    console.error('❌ Error fetching recent tool calls:', error);
    return [];
  }
}

// Get analytics data from MongoDB
async function getAnalytics() {
  try {
    if (!database.isConnectionReady()) {
      console.warn('⚠️ Database not ready, returning empty analytics');
      return {
        chats: { total: 0, today: 0, thisWeek: 0 },
        tools: { userDetailsRecorded: 0, unknownQuestions: 0, total: 0 },
        users: { uniqueIPs: 0, total: 0 },
      };
    }

    // Get analytics from all models
    const [chatAnalytics, toolAnalytics, userStats] = await Promise.all([
      Chat.getAnalytics(),
      ToolCall.getToolAnalytics(),
      User.getUserStats(),
    ]);

    return {
      chats: chatAnalytics.chats,
      tools: {
        userDetailsRecorded: toolAnalytics.userDetailsRecorded,
        unknownQuestions: toolAnalytics.unknownQuestions,
        total: toolAnalytics.total,
        today: toolAnalytics.today,
        thisWeek: toolAnalytics.thisWeek,
        successRate: toolAnalytics.successRate,
        commonQuestions: toolAnalytics.mostCommonUnknownQuestions,
      },
      users: {
        uniqueIPs: chatAnalytics.users.uniqueIPs,
        total: userStats.total,
        active: userStats.active,
        averageInteractions: userStats.averageInteractions,
        topUsers: userStats.topUsers,
      },
      activeSessions: chatAnalytics.activeSessions,
    };
  } catch (error) {
    console.error('❌ Error generating analytics:', error);
    return {
      chats: { total: 0, today: 0, thisWeek: 0 },
      tools: { userDetailsRecorded: 0, unknownQuestions: 0, total: 0 },
      users: { uniqueIPs: 0, total: 0 },
    };
  }
}

module.exports = {
  logChatSession,
  logToolCall,
  getRecentChats,
  getRecentToolCalls,
  getAnalytics,
};

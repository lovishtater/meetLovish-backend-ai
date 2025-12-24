const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema(
  {
    // Session and user identification
    sessionId: {
      type: String,
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Message content
    userMessage: {
      type: String,
      required: true,
      maxlength: 2000,
    },

    assistantMessage: {
      type: String,
      required: true,
      maxlength: 5000,
    },

    // Tool outputs used in this conversation
    toolOutputs: [
      {
        type: {
          type: String,
          enum: ['user_details', 'unknown_question'],
          // required: true,
        },
        data: mongoose.Schema.Types.Mixed,
      },
    ],

    // Session context
    messageCount: {
      type: Number,
      default: 1,
      min: 1,
    },

    // Timestamps
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    // Schema options
    timestamps: true, // Adds createdAt and updatedAt
    collection: 'chats',
  }
);

// Indexes for performance
ChatSchema.index({ timestamp: -1 }); // Most recent first
ChatSchema.index({ sessionId: 1, timestamp: -1 }); // Session history
ChatSchema.index({ userId: 1, timestamp: -1 }); // User-based queries

// Static methods
ChatSchema.statics.getRecentChats = function (limit = 50) {
  return this.find().sort({ timestamp: -1 }).limit(limit).lean();
};

ChatSchema.statics.getChatsBySession = function (sessionId) {
  return this.find({ sessionId }).sort({ timestamp: 1 }).lean();
};

ChatSchema.statics.getConversationHistory = function (userId, sessionId, limit = 10) {
  // Get recent conversation history for the user, prioritizing current session
  return this.find({
    $or: [
      { sessionId: sessionId }, // Current session messages
      { userId: userId }, // Recent messages from same user
    ],
  })
    .sort({ timestamp: -1 }) // Most recent first
    .limit(limit)
    .sort({ timestamp: 1 }) // Then sort chronologically for conversation flow
    .lean();
};

ChatSchema.statics.getChatsByUser = function (userId, days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.find({
    userId,
    timestamp: { $gte: startDate },
  })
    .sort({ timestamp: -1 })
    .lean();
};

ChatSchema.statics.getAnalytics = function () {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return Promise.all([
    // Total chats
    this.countDocuments(),

    // Chats today
    this.countDocuments({ timestamp: { $gte: today } }),

    // Chats this week
    this.countDocuments({ timestamp: { $gte: thisWeek } }),

    // Unique users
    this.distinct('userId'),

    // Most active sessions
    this.aggregate([{ $group: { _id: '$sessionId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
  ]).then(([total, today, thisWeek, uniqueUsers, activeSessions]) => ({
    chats: {
      total,
      today,
      thisWeek,
    },
    users: {
      uniqueUsers: uniqueUsers.length,
    },
    activeSessions,
  }));
};

// Instance methods
ChatSchema.methods.toPublic = function () {
  return {
    id: this._id,
    sessionId: this.sessionId,
    userMessage: this.userMessage,
    assistantMessage: this.assistantMessage,
    toolOutputs: this.toolOutputs,
    messageCount: this.messageCount,
    timestamp: this.timestamp,
  };
};

module.exports = mongoose.model('Chat', ChatSchema);

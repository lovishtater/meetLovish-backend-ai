const mongoose = require('mongoose');

const ToolCallSchema = new mongoose.Schema(
  {
    // Tool identification
    type: {
      type: String,
      enum: ['user_details', 'unknown_question'],
      required: true,
      index: true,
    },

    // Tool-specific data
    data: {
      // For user_details
      email: String,
      name: String,
      notes: String,

      // For unknown_question
      question: String,
    },

    // Context
    sessionId: {
      type: String,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    userInfo: {
      ip: String,
      userAgent: String,
      geolocation: {
        country: String,
        region: String,
        city: String,
        ll: [Number],
        timezone: String,
      },
    },

    // Result tracking
    result: {
      status: {
        type: String,
        enum: ['success', 'error'],
        default: 'success',
      },
      message: String,
      processingTime: Number, // in milliseconds
    },

    // Timestamps
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'toolcalls',
  }
);

// Indexes for performance
ToolCallSchema.index({ timestamp: -1 });
ToolCallSchema.index({ type: 1, timestamp: -1 });
ToolCallSchema.index({ sessionId: 1, timestamp: -1 });
ToolCallSchema.index({ userId: 1, timestamp: -1 });
ToolCallSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // Auto-delete after 90 days

// Static methods
ToolCallSchema.statics.getRecentToolCalls = function (limit = 50) {
  return this.find().sort({ timestamp: -1 }).limit(limit).lean();
};

ToolCallSchema.statics.getToolCallsByType = function (type, limit = 50) {
  return this.find({ type }).sort({ timestamp: -1 }).limit(limit).lean();
};

ToolCallSchema.statics.getToolCallsBySession = function (sessionId) {
  return this.find({ sessionId }).sort({ timestamp: 1 }).lean();
};

ToolCallSchema.statics.getToolCallsByUser = function (userId) {
  return this.find({ userId }).sort({ timestamp: -1 }).lean();
};

ToolCallSchema.statics.getToolAnalytics = function () {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return Promise.all([
    // Total tool calls
    this.countDocuments(),

    // User details recorded
    this.countDocuments({ type: 'user_details' }),

    // Unknown questions
    this.countDocuments({ type: 'unknown_question' }),

    // Tool calls today
    this.countDocuments({ timestamp: { $gte: today } }),

    // Tool calls this week
    this.countDocuments({ timestamp: { $gte: thisWeek } }),

    // Success rate
    this.aggregate([
      {
        $group: {
          _id: '$result.status',
          count: { $sum: 1 },
        },
      },
    ]),

    // Most common unknown questions
    this.aggregate([
      { $match: { type: 'unknown_question' } },
      { $group: { _id: '$data.question', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]).then(([total, userDetails, unknownQuestions, today, thisWeek, successRate, commonQuestions]) => ({
    total,
    userDetailsRecorded: userDetails,
    unknownQuestions,
    today,
    thisWeek,
    successRate: successRate.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    mostCommonUnknownQuestions: commonQuestions,
  }));
};

// Instance methods
ToolCallSchema.methods.markSuccess = function (message, processingTime) {
  this.result.status = 'success';
  this.result.message = message;
  this.result.processingTime = processingTime;
  return this;
};

ToolCallSchema.methods.markError = function (message, processingTime) {
  this.result.status = 'error';
  this.result.message = message;
  this.result.processingTime = processingTime;
  return this;
};

ToolCallSchema.methods.toPublic = function () {
  return {
    id: this._id,
    type: this.type,
    data: this.data,
    timestamp: this.timestamp,
    result: this.result,
    userInfo: {
      geolocation: this.userInfo?.geolocation,
    }, // Exclude sensitive info
  };
};

module.exports = mongoose.model('ToolCall', ToolCallSchema);

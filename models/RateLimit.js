const mongoose = require('mongoose');

const rateLimitSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['ip', 'userToken', 'fingerprint'],
    },
    dailyCount: {
      type: Number,
      default: 0,
    },
    hourlyCount: {
      type: Number,
      default: 0,
    },
    dailyResetTime: {
      type: Date,
      required: true,
    },
    hourlyResetTime: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
rateLimitSchema.index({ identifier: 1, type: 1 }, { unique: true });
rateLimitSchema.index({ dailyResetTime: 1 });
rateLimitSchema.index({ hourlyResetTime: 1 });

module.exports = mongoose.model('RateLimit', rateLimitSchema);

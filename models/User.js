const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    // Contact information
    email: {
      type: String,
      // unique: true,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: function (email) {
          if (!email) {
            return true;
          } // Allow empty email
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emailRegex.test(email);
        },
        message: 'Please provide a valid email address',
      },
    },

    name: {
      type: String,
      trim: true,
    },

    // Additional context from conversations
    notes: {
      type: String,
      maxlength: 1000,
    },

    // Session tracking
    sessions: [
      {
        sessionId: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        messageCount: {
          type: Number,
          default: 0,
        },
        lastActivity: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // User token for identification
    token: {
      type: String,
      unique: true,
      index: true,
    },

    // User metadata
    userInfo: {
      firstSeenIP: String,
      lastSeenIP: String,
      geolocation: {
        country: String,
        region: String,
        city: String,
        ll: [Number], // [latitude, longitude]
        timezone: String,
      },
      browser: {
        name: String,
        version: String,
        os: String,
      },
    },

    // Analytics
    totalMessages: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastActivity: {
      type: Date,
      default: Date.now,
    },

    // Status
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked'],
      default: 'active',
    },

    // Tags for organization
    tags: [String],
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Indexes
UserSchema.index({ lastInteraction: -1 });
UserSchema.index({ totalInteractions: -1 });
UserSchema.index({ 'userInfo.firstSeenIP': 1 });

// Static methods
UserSchema.statics.findOrCreateByToken = async function (token, userInfo) {
  try {
    // Try to find existing user by token
    let user = await this.findOne({ token });

    if (user) {
      // Update existing user's last seen info
      user.userInfo.lastSeenIP = userInfo?.ip || user.userInfo.lastSeenIP;
      user.lastActivity = new Date();
      await user.save();
      return { user, isNew: false };
    } else {
      // Create new user with token
      const crypto = require('crypto');
      const newToken = token || crypto.randomBytes(32).toString('hex');

      user = new this({
        token: newToken,
        userInfo: {
          firstSeenIP: userInfo?.ip,
          lastSeenIP: userInfo?.ip,
          geolocation: userInfo?.geolocation,
          browser: userInfo?.browser,
        },
      });

      await user.save();
      return { user, isNew: true };
    }
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate token error, try to find and update
      const user = await this.findOne({ token });
      if (user) {
        return { user, isNew: false };
      }
    }
    throw error;
  }
};

UserSchema.statics.findByToken = async function (token) {
  return this.findOne({ token });
};

UserSchema.statics.getRecentUsers = function (limit = 50) {
  return this.find().sort({ lastInteraction: -1 }).limit(limit).lean();
};

UserSchema.statics.getUserStats = function () {
  return Promise.all([
    this.countDocuments(),
    this.countDocuments({ status: 'active' }),
    this.aggregate([{ $group: { _id: null, avgMessages: { $avg: '$totalMessages' } } }]),
    this.find().sort({ totalMessages: -1 }).limit(10).lean(),
  ]).then(([total, active, avgResult, topUsers]) => ({
    total,
    active,
    averageMessages: avgResult[0]?.avgMessages || 0,
    topUsers,
  }));
};

// Instance methods
UserSchema.methods.addSession = function (sessionId) {
  // Check if session already exists
  const existingSession = this.sessions.find(s => s.sessionId === sessionId);

  if (!existingSession) {
    this.sessions.push({
      sessionId,
      timestamp: new Date(),
      messageCount: 0,
      lastActivity: new Date(),
    });
  }

  return this.save();
};

UserSchema.methods.updateSessionActivity = function (sessionId) {
  const session = this.sessions.find(s => s.sessionId === sessionId);
  if (session) {
    session.messageCount += 1;
    session.lastActivity = new Date();
    this.totalMessages += 1;
    this.lastActivity = new Date();
  }

  return this.save();
};

UserSchema.methods.updateUserDetails = function (email = '', name = '', notes = '') {
  let updated = false;

  // Update email if provided and different
  if (email && email.trim() && email !== this.email) {
    this.email = email.trim().toLowerCase();
    updated = true;
  }

  // Update name if provided and different
  if (name && name.trim() && name !== this.name) {
    this.name = name.trim();
    updated = true;
  }

  // Append notes if provided
  if (notes && notes.trim()) {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const newNote = `[${timestamp}] ${notes.trim()}`;

    if (this.notes) {
      // Avoid duplicate notes
      if (!this.notes.includes(newNote)) {
        this.notes = this.notes + '\n' + newNote;
        updated = true;
      }
    } else {
      this.notes = newNote;
      updated = true;
    }
  }

  // Update last activity if any changes were made
  if (updated) {
    this.lastActivity = new Date();
  }

  return this.save();
};

UserSchema.methods.toPublic = function () {
  return {
    id: this._id,
    token: this.token,
    totalMessages: this.totalMessages,
    lastActivity: this.lastActivity,
    status: this.status,
    sessionsCount: this.sessions.length,
    userInfo: {
      geolocation: this.userInfo.geolocation,
      browser: this.userInfo.browser,
    },
  };
};

module.exports = mongoose.model('User', UserSchema);

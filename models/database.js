const mongoose = require('mongoose');

class Database {
  constructor() {
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    try {
      // Connection options for production
      const options = {
        // Connection management
        maxPoolSize: 100, // Maximum number of connections
        minPoolSize: 10, // Minimum number of connections
        maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
        serverSelectionTimeoutMS: 5000, // How long to try selecting a server
        socketTimeoutMS: 45000, // How long to wait for a response

        // Resilience options
        retryWrites: true,
        retryReads: true,

        // For development/debugging
        bufferCommands: false, // Disable mongoose buffering
      };

      const mongoUri = process.env.MONGODB_URI;

      console.log('🔌 Connecting to MongoDB...');

      await mongoose.connect(mongoUri, options);

      this.isConnected = true;
      this.reconnectAttempts = 0;

      console.log('✅ MongoDB connected successfully');
      console.log(`📍 Database: ${mongoose.connection.name}`);

      // Set up event listeners
      this.setupEventListeners();
    } catch (error) {
      console.error('❌ MongoDB connection error:', error.message);
      this.isConnected = false;

      // Retry connection with exponential backoff
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
        console.log(
          `🔄 Retrying connection in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );

        setTimeout(() => {
          this.connect();
        }, delay);
      } else {
        console.error('💥 Max reconnection attempts reached. Manual intervention required.');
        throw error;
      }
    }
  }

  setupEventListeners() {
    const db = mongoose.connection;

    db.on('connected', () => {
      console.log('📡 MongoDB connected');
      this.isConnected = true;
    });

    db.on('error', error => {
      console.error('❌ MongoDB error:', error);
      this.isConnected = false;
    });

    db.on('disconnected', () => {
      console.log('📴 MongoDB disconnected');
      this.isConnected = false;

      // Auto-reconnect if not shutting down
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log('🔄 Attempting to reconnect...');
        this.connect();
      }
    });

    db.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🛑 Shutting down MongoDB connection...');
      await this.disconnect();
      throw new Error('Process terminated (SIGINT) after MongoDB disconnect.');
    });

    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down MongoDB connection...');
      await this.disconnect();
      throw new Error('Process terminated (SIGTERM) after MongoDB disconnect.');
    });
  }

  async disconnect() {
    try {
      await mongoose.connection.close();
      console.log('✅ MongoDB disconnected gracefully');
    } catch (error) {
      console.error('❌ Error disconnecting from MongoDB:', error);
    }
  }

  isConnectionReady() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  getConnectionStatus() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      status: states[mongoose.connection.readyState] || 'unknown',
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
    };
  }
}

// Export singleton instance
const database = new Database();
module.exports = database;

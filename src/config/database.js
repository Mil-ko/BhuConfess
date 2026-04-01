// src/config/database.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class DatabaseConnection {
    constructor() {
        this.isConnected = false;
        this.connection = null;
    }

    async connect() {
        try {
            if (this.isConnected) {
                logger.info('Using existing database connection');
                return this.connection;
            }

            const MONGODB_URI = process.env.MONGODB_URI;
            
            if (!MONGODB_URI) {
                throw new Error('MONGODB_URI is not defined in environment variables');
            }

            // Mongoose connection options
            const options = {
                autoIndex: true, // Build indexes
                maxPoolSize: 10, // Maintain up to 10 socket connections
                serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
                socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
                family: 4, // Use IPv4, skip trying IPv6
                retryWrites: true,
                retryReads: true
            };

            logger.info('Connecting to MongoDB Atlas...');

            // Connect to MongoDB
            this.connection = await mongoose.connect(MONGODB_URI, options);
            
            this.isConnected = true;
            
            logger.info('✅ Successfully connected to MongoDB Atlas');
            
            // Log connection info (without sensitive data)
            const dbName = this.connection.connection.db.databaseName;
            const host = this.connection.connection.host;
            logger.info(`📊 Database: ${dbName} on ${host}`);

            // Set up connection event handlers
            mongoose.connection.on('error', (error) => {
                logger.error('MongoDB connection error:', error);
                this.isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                logger.warn('MongoDB disconnected');
                this.isConnected = false;
            });

            mongoose.connection.on('reconnected', () => {
                logger.info('MongoDB reconnected');
                this.isConnected = true;
            });

            // Graceful shutdown
            process.on('SIGINT', this.disconnect.bind(this));
            process.on('SIGTERM', this.disconnect.bind(this));

            return this.connection;

        } catch (error) {
            logger.error('❌ Failed to connect to MongoDB:', error.message);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (!this.isConnected) {
                return;
            }

            await mongoose.disconnect();
            this.isConnected = false;
            logger.info('Disconnected from MongoDB');
            
        } catch (error) {
            logger.error('Error disconnecting from MongoDB:', error);
        }
    }

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            readyState: mongoose.connection.readyState,
            dbName: mongoose.connection.name,
            host: mongoose.connection.host
        };
    }
}

module.exports = new DatabaseConnection();
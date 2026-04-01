// server.js
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const telegramService = require('./src/services/telegram.service');
const databaseService = require('./src/services/database.service');
const authMiddleware = require('./src/middleware/auth.middleware');
const logger = require('./src/utils/logger');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Security and utility middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(express.json()); // Parse JSON bodies
app.use(authMiddleware.rateLimiter); // Rate limiting

// Health check route with database status
app.get('/health', async (req, res) => {
    const dbHealth = await databaseService.healthCheck();
    
    res.json({ 
        status: 'OK', 
        message: 'Confession Bot is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        botToken: process.env.BOT_TOKEN ? '✓ Configured' : '✗ Missing',
        adminId: process.env.ADMIN_ID ? '✓ Configured' : '✗ Missing',
        database: dbHealth,
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0'
    });
});

// Database stats endpoint (optional, for monitoring)
app.get('/stats', async (req, res) => {
    try {
        const stats = await databaseService.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Start server
app.listen(PORT, () => {
    logger.info(`🚀 Express server running on port ${PORT}`);
    logger.info(`🔍 Health check: http://localhost:${PORT}/health`);
    logger.info(`📊 Stats: http://localhost:${PORT}/stats`);
});

// Initialize and launch Telegram bot with database
(async () => {
    try {
        // Check for required environment variables
        if (!process.env.BOT_TOKEN) {
            throw new Error('BOT_TOKEN is missing in .env file');
        }

        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is missing in .env file');
        }

        // Log startup
        logger.info('Starting Confession Bot...');
        logger.info(`Environment: ${process.env.NODE_ENV}`);

        // Initialize database connection first
        logger.info('Initializing database connection...');
        await databaseService.initialize();
        
        // Initialize and launch bot
        telegramService.initialize(process.env.BOT_TOKEN);
        await telegramService.launch();
        
        logger.info('✨ Bot is ready! Start chatting on Telegram');
        
    } catch (error) {
        logger.error('❌ Failed to start application:', error);
        process.exit(1);
    }
})();

// Graceful shutdown handlers
process.once('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    telegramService.stop();
    await databaseService.healthCheck(); // Will trigger disconnect if needed
    process.exit(0);
});

process.once('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    telegramService.stop();
    await databaseService.healthCheck(); // Will trigger disconnect if needed
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    telegramService.stop();
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
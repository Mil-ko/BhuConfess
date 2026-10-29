// server.js
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const telegramService = require('./src/services/telegram.service');
const databaseService = require('./src/services/database.service');
const authMiddleware = require('./src/middleware/auth.middleware');
const keepalive = require('./src/utils/keepalive');
const logger = require('./src/utils/logger');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set by the signal handler so a launch() that resolves *because* we are
// shutting down isn't mistaken for a bot that died on its own (see below).
let shuttingDown = false;

// Render (like every PaaS) terminates TLS on its own proxy and forwards the
// real client IP in X-Forwarded-For. Without this, express-rate-limit warns
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and keys every request on the proxy, so
// all visitors share one bucket (the proxy's own /health probes then 429 and
// the service looks unhealthy). It is only enabled when running on Render (or
// explicitly), so a local run can't be spoofed with a forged header.
// TRUST_PROXY overrides it: a hop count, "true", or "false" to disable.
const trustProxy = process.env.TRUST_PROXY !== undefined
    ? process.env.TRUST_PROXY
    : (process.env.RENDER === 'true' ? '1' : null);
if (trustProxy !== null && trustProxy !== 'false') {
    const hops = Number(trustProxy);
    if (trustProxy !== '' && Number.isFinite(hops)) {
        app.set('trust proxy', hops); // "1" (one proxy hop) or "2"
    } else {
        app.set('trust proxy', true); // "true" -> trust the whole chain
    }
}

// Security and utility middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(express.json()); // Parse JSON bodies
app.use(authMiddleware.rateLimiter); // Rate limiting

// Bound the DB ping so a stalled Mongo socket cannot hang the health check
// past the platform's probe timeout (which would look like a dead service).
const DB_PING_TIMEOUT_MS = Number(process.env.DB_PING_TIMEOUT_MS) || 4000;

function withTimeout(promise, ms, fallback) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Health check route with database status
app.get('/health', async (req, res) => {
    const dbHealth = await withTimeout(
        databaseService.healthCheck(),
        DB_PING_TIMEOUT_MS,
        { isConnected: false, dbStatus: 'timeout', error: 'Database ping timed out' }
    );
    
    res.json({ 
        status: 'OK', 
        message: 'Confession Bot is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        botToken: process.env.BOT_TOKEN ? '✓ Configured' : '✗ Missing',
        adminId: process.env.ADMIN_ID ? '✓ Configured' : '✗ Missing',
        // Tells a live poller apart from a process that is up but no longer
        // receiving updates - the failure mode that looks like "it just stopped".
        bot: telegramService.getStatus(),
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
// Host platforms (Render, Railway, ...) route traffic to the container's
// external interface, so bind explicitly to 0.0.0.0 instead of loopback.
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    logger.info(`🚀 Express server listening on ${HOST}:${PORT}`);
    // On Render the public origin is injected; locally fall back to loopback.
    const publicUrl = (process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    logger.info(`🔍 Health check: ${publicUrl}/health`);
    logger.info(`📊 Stats: ${publicUrl}/stats`);

    // Render's public origin is the only URL that reaches the app from outside,
    // so it is what the keep-alive pings (see src/utils/keepalive.js).
    if (String(process.env.KEEPALIVE).toLowerCase() === 'true') {
        keepalive.start({
            baseUrl: process.env.RENDER_EXTERNAL_URL,
            intervalMs: process.env.KEEPALIVE_INTERVAL_MS
        });
    } else if (process.env.RENDER === 'true') {
        logger.warn('Free plan: this instance spins down after 15 min without inbound traffic and stops the bot. Set KEEPALIVE=true (or upgrade the instance type) to stay online.');
    }
});

server.on('error', (error) => {
    logger.error(`❌ HTTP server could not bind ${HOST}:${PORT} - ${error.message}`);
    process.exit(1);
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

        // launch() only resolves once polling stops. Unless that was our own
        // shutdown, the process is now an HTTP server with no bot attached:
        // it looks healthy to Render and answers nothing on Telegram. Exit so
        // the platform restarts it with a clean poller.
        if (!shuttingDown) {
            logger.error('❌ Bot polling loop ended on its own - exiting so the platform restarts the service');
            process.exit(1);
        }
        logger.info('Bot stopped, shutdown complete');
        
    } catch (error) {
        logger.error('❌ Failed to start application:', error);
        process.exit(1);
    }
})();

// Graceful shutdown handlers
// The platform sends SIGTERM and then SIGKILLs after a grace period, so stop
// polling, stop accepting connections and exit instead of hanging.
async function shutdown(signal) {
    shuttingDown = true;
    logger.info(`Received ${signal} - shutting down`);
    telegramService.stop();

    await new Promise((resolve) => {
        server.close(resolve);
        // Keep-alive sockets (e.g. the platform's health checker) would
        // otherwise hold the server open until the SIGKILL.
        if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
        }
    }).catch(() => {});

    // Mongoose handlers in config/database.js disconnect on SIGTERM; this call
    // only nudges them, so it must never delay the exit past the grace period.
    await withTimeout(databaseService.healthCheck(), 3000, null).catch(() => {});
    process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

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
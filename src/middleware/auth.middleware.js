// src/middleware/auth.middleware.js
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

class AuthMiddleware {
    constructor() {
        this.adminId = process.env.ADMIN_ID;
    }

    // Check if user is admin (for bot commands)
    isAdmin = (ctx, next) => {
        try {
            const userId = ctx.from?.id?.toString();
            const isAdmin = userId === this.adminId;

            if (!isAdmin) {
                logger.warn(`Unauthorized admin access attempt by user ${userId}`);
                ctx.reply('⛔ This command is only available to administrators.');
                return;
            }

            logger.info(`Admin command executed by user ${userId}`);
            return next();
        } catch (error) {
            logger.error('Admin check error:', error);
            ctx.reply('Error checking admin status.');
        }
    }

    // Middleware to check if user is admin (for Express routes)
    isAdminApi = (req, res, next) => {
        // For now, we'll use a simple API key approach
        // In production, you'd want proper authentication
        const apiKey = req.headers['x-admin-key'];
        
        if (apiKey !== process.env.ADMIN_API_KEY) {
            logger.warn(`Unauthorized API access attempt from IP: ${req.ip}`);
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        next();
    }

    // Rate limiting for Express
    get rateLimiter() {
        return rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // limit each IP to 100 requests per windowMs
            message: 'Too many requests from this IP, please try again later.',
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
                res.status(429).json({
                    error: 'Too many requests, please try again later.'
                });
            }
        });
    }

    // Bot rate limiting
    async checkBotRateLimit(ctx, next) {
        const userId = ctx.from?.id;
        const now = Date.now();
        
        if (!global.userMessageTimestamps) {
            global.userMessageTimestamps = new Map();
        }

        const userLastMessage = global.userMessageTimestamps.get(userId) || 0;
        const timeSinceLastMessage = now - userLastMessage;

        if (timeSinceLastMessage < 1000) {
            logger.debug(`Rate limit triggered for user ${userId}`);
            await ctx.reply('⏱️ Please wait a moment before sending another message.');
            return;
        }

        global.userMessageTimestamps.set(userId, now);
        return next();
    }
}

module.exports = new AuthMiddleware();
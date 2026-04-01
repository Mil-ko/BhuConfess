// src/services/telegram.service.js
const { Telegraf, session } = require('telegraf');
const botController = require('../controllers/bot.controller');
const adminController = require('../controllers/admin.controller');
const authMiddleware = require('../middleware/auth.middleware');
const databaseService = require('./database.service');
const { STATUS } = require('../utils/constants');
const logger = require('../utils/logger');

class TelegramService {
    constructor() {
        this.bot = null;
    }

    // Initialize bot with token
    initialize(token) {
        if (!token) {
            throw new Error('Bot token is required');
        }

        this.bot = new Telegraf(token);
        
        // Use session middleware
        this.bot.use(session());
        
        // Add rate limiting middleware
        this.bot.use(authMiddleware.checkBotRateLimit.bind(authMiddleware));
        
        this.setupHandlers();
        return this.bot;
    }

    // Setup all bot command and message handlers
    setupHandlers() {
        if (!this.bot) return;

        // Public command handlers
        this.bot.start(botController.handleStart.bind(botController));
        this.bot.help(botController.handleHelp.bind(botController));
        this.bot.command('privacy', botController.handlePrivacy.bind(botController));
        this.bot.command('about', botController.handleAbout.bind(botController));
        this.bot.command('status', botController.handleStatus.bind(botController));

        // Admin commands
        this.bot.command('pending', authMiddleware.isAdmin, adminController.viewPending.bind(adminController));
        this.bot.command('stats', authMiddleware.isAdmin, adminController.getStats.bind(adminController));
        this.bot.command('list', authMiddleware.isAdmin, adminController.listConfessions.bind(adminController));
        this.bot.command('adminhelp', authMiddleware.isAdmin, adminController.adminHelp.bind(adminController));
        this.bot.command('approve', authMiddleware.isAdmin, this.handleApproveCommand.bind(this));
        this.bot.command('reject', authMiddleware.isAdmin, this.handleRejectCommand.bind(this));
        this.bot.command('view', authMiddleware.isAdmin, this.handleViewCommand.bind(this));

        // Channel commands
        this.bot.command('setchannel', authMiddleware.isAdmin, adminController.setChannel.bind(adminController));
        this.bot.command('post', authMiddleware.isAdmin, adminController.postToChannel.bind(adminController));
        this.bot.command('preview', authMiddleware.isAdmin, adminController.previewChannelPost.bind(adminController));
        this.bot.command('channelstatus', authMiddleware.isAdmin, adminController.channelStatus.bind(adminController));

        // Handle callback queries
        this.bot.on('callback_query', authMiddleware.isAdmin, adminController.handleCallback.bind(adminController));
        // Handle text messages
        this.bot.on('text', async (ctx, next) => {
            // First: handle confirmation replies
            if (ctx.session && ctx.session.waitingForConfirmation) {
                await adminController.handleConfirmation(ctx);
            } else if (ctx.session && ctx.session.pendingRejection) {
                await adminController.handleRejectionReason(ctx);
            } else {
                // Regular confession
                await botController.handleMessage(ctx);
            }
            return next();
        });

        // Handle errors
        this.bot.catch(botController.handleError.bind(botController));

        logger.info('Bot handlers configured');
    }

    // Handle approve command with ID
    async handleApproveCommand(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply('Please provide a confession ID. Usage: /approve [confession_id]');
                return;
            }

            const confessionId = args[1];
            await adminController.approveConfession(ctx, confessionId);
        } catch (error) {
            logger.error('Error in approve command:', error);
            await ctx.reply('Error processing approve command');
        }
    }

    // Handle reject command with ID
    async handleRejectCommand(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply('Please provide a confession ID. Usage: /reject [confession_id]');
                return;
            }

            const confessionId = args[1];
            const reason = args.slice(2).join(' ') || null;
            
            if (reason) {
                // Direct rejection with reason
                const adminId = ctx.from.id.toString();
                const updateResult = await databaseService.updateConfessionStatus(
                    confessionId,
                    STATUS.REJECTED,
                    adminId,
                    reason
                );

                if (updateResult.success) {
                    await ctx.replyWithMarkdown(`❌ Confession rejected.\nReason: ${reason}`);
                } else {
                    await ctx.reply('Failed to reject confession');
                }
            } else {
                // Use callback flow for reason
                ctx.session = ctx.session || {};
                ctx.session.pendingRejection = confessionId;
                await ctx.reply('Please provide a reason for rejection:');
            }
        } catch (error) {
            logger.error('Error in reject command:', error);
            await ctx.reply('Error processing reject command');
        }
    }

    // Handle view command
    async handleViewCommand(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply('Please provide a confession ID. Usage: /view [confession_id]');
                return;
            }

            const confessionId = args[1];
            await adminController.viewFullConfession(ctx, confessionId);
        } catch (error) {
            logger.error('Error in view command:', error);
            await ctx.reply('Error processing view command');
        }
    }

    // Launch the bot
    async launch() {
        try {
            await this.bot.launch();
            logger.info('🤖 Bot launched successfully');
            
            // Get bot info
            const botInfo = await this.bot.telegram.getMe();
            logger.info(`📱 Bot Info: @${botInfo.username} (ID: ${botInfo.id})`);
            
            // Log admin status
            if (process.env.ADMIN_ID) {
                logger.info(`👮 Admin ID configured: ${process.env.ADMIN_ID}`);
            } else {
                logger.warn('⚠️ No ADMIN_ID configured - admin commands will not work');
            }
            
            return true;
        } catch (error) {
            logger.error('Failed to launch bot:', error);
            throw error;
        }
    }

    // Stop the bot gracefully
    stop() {
        if (this.bot) {
            this.bot.stop();
            logger.info('🛑 Bot stopped');
        }
    }
}

module.exports = new TelegramService();
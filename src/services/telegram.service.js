// src/services/telegram.service.js
const { Telegraf, session } = require('telegraf');
const botController = require('../controllers/bot.controller');
const adminController = require('../controllers/admin.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { COMMANDS, MESSAGES } = require('../utils/constants');
const logger = require('../utils/logger');

const ID_RE = /^[0-9a-f]{24}$/i;

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

        // One session per USER (not per chat): a comment flow can start from
        // a button on a channel post and continue in the bot's private chat.
        this.bot.use(session({
            getSessionKey: (ctx) => (ctx.from ? String(ctx.from.id) : undefined)
        }));

        this.setupHandlers();
        return this.bot;
    }

    // Setup all bot command, callback and message handlers
    setupHandlers() {
        if (!this.bot) return;
        const bot = this.bot;

        // ── Public commands ────────────────────────────────────
        bot.start((ctx) => botController.handleStart(ctx));
        bot.help((ctx) => botController.handleHelp(ctx));
        bot.command('privacy', (ctx) => botController.handlePrivacy(ctx));
        bot.command('about', (ctx) => botController.handleAbout(ctx));
        bot.command('status', (ctx) => botController.handleStatus(ctx));

        // ── Admin commands (permission checked in the middleware) ──
        bot.command('pending', authMiddleware.isAdmin, (ctx) => adminController.viewPending(ctx));
        bot.command('stats', authMiddleware.isAdmin, (ctx) => adminController.getStats(ctx));
        bot.command('setchannel', authMiddleware.isAdmin, (ctx) => adminController.setChannel(ctx));
        bot.command('post', authMiddleware.isAdmin, (ctx) => adminController.postCommand(ctx));
        bot.command('adminhelp', authMiddleware.isAdmin, (ctx) => adminController.adminHelp(ctx));

        // ── Central callback router (all inline buttons) ───────
        bot.on('callback_query', (ctx) => this.routeCallback(ctx));

        // ── Text messages → flow state machine (rate limited) ──
        bot.on('text', (ctx, next) =>
            authMiddleware.checkBotRateLimit(ctx, () => botController.handleText(ctx)));

        // ── Errors ─────────────────────────────────────────────
        bot.catch((error, ctx) => {
            logger.error(`Bot error on ${ctx.updateType}:`, error);
        });

        logger.info('Bot handlers configured');
    }

    // Route every inline-button press by its callback-data prefix.
    // Callback data format: <prefix>_<action>_<id>[_<page>]
    async routeCallback(ctx) {
        const data = ctx.callbackQuery && ctx.callbackQuery.data;
        if (!data) return;

        try {
            const parts = String(data).split('_');
            const prefix = parts[0];

            // Admin decisions - permission checked SERVER SIDE every time
            if (prefix === 'ad') {
                if (!authMiddleware.isAdminId(ctx.from.id)) {
                    logger.warn(`Unauthorized admin callback by ${ctx.from.id}: ${data}`);
                    await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
                    return;
                }
                const action = parts[1];
                const id = parts[2];
                if (!id || !ID_RE.test(id)) {
                    await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                    return;
                }
                await adminController.handleDecision(ctx, id, action === 'ok');
                return;
            }

            switch (prefix) {
                // Menu / info
                case 'm': {
                    const action = parts[1];
                    if (action === 'menu') return botController.showMenu(ctx);
                    if (action === 'help') return botController.showHelp(ctx);
                    if (action === 'profile') return botController.showProfile(ctx);
                    if (action === 'nick') return botController.startNicknameChange(ctx);
                    break;
                }

                // Confession flow
                case 'c': {
                    const action = parts[1];
                    switch (action) {
                        case 'start': return botController.startConfession(ctx);
                        case 'topic': return botController.chooseTopic(ctx, parts[2]);
                        case 'edit': return botController.editConfession(ctx);
                        case 'submit': return botController.submitConfession(ctx);
                        case 'cancel': return botController.cancelConfession(ctx);
                    }
                    break;
                }

                // Browse comments: cb_<confessionId>_<page>
                case 'cb': {
                    if (!parts[1] || !ID_RE.test(parts[1])) {
                        await this._answer(ctx, MESSAGES.CONFESSION_NOT_FOUND);
                        return;
                    }
                    return botController.browseComments(ctx, parts[1], parts[2]);
                }

                // Comment actions: cn_<action>_<id>
                case 'cn': {
                    const action = parts[1];
                    const id = parts[2];
                    if (!id || !ID_RE.test(id)) {
                        await this._answer(ctx, MESSAGES.CONFESSION_NOT_FOUND);
                        return;
                    }
                    switch (action) {
                        case 'new': return botController.startComment(ctx, id);
                        case 'sub': return botController.submitComment(ctx, id);
                        case 'can': return botController.cancelComment(ctx, id);
                        case 'rep': return botController.startReply(ctx, id);
                        case 'rsub': return botController.submitReply(ctx, id);
                        case 'rcan': return botController.cancelReply(ctx, id);
                    }
                    break;
                }
            }

            logger.warn(`Unknown callback data: ${data}`);
            await this._answer(ctx, 'Unknown action');
        } catch (error) {
            logger.error('Error routing callback:', error);
            await this._answer(ctx, MESSAGES.ERROR);
        }
    }

    async _answer(ctx, text) {
        if (!ctx.callbackQuery) return;
        try {
            await ctx.answerCbQuery(text);
        } catch (e) {
            // expired or already answered
        }
    }

    // Launch the bot
    async launch() {
        try {
            // Register the command list shown in Telegram's UI
            try {
                await this.bot.telegram.setMyCommands(COMMANDS);
            } catch (error) {
                logger.warn(`setMyCommands failed: ${error.message}`);
            }

            // NOTE: in Telegraf 4, launch() only resolves after the bot
            // stops - so all "launched" logging happens in the onLaunch
            // callback, which fires right after getMe succeeds.
            const onLaunch = () => {
                const botInfo = this.bot.botInfo;
                logger.info('🤖 Bot launched successfully (long polling)');
                logger.info(`📱 Bot Info: @${botInfo.username} (ID: ${botInfo.id})`);

                if (authMiddleware.adminIds.length) {
                    logger.info(`👮 Admin IDs configured: ${authMiddleware.adminIds.join(', ')}`);
                } else {
                    logger.warn('⚠️ No ADMIN_ID configured - admin commands will not work');
                }
            };

            await this.bot.launch({}, onLaunch);
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

// src/services/telegram.service.js
const { Telegraf, session } = require('telegraf');
const botController = require('../controllers/bot.controller');
const adminController = require('../controllers/admin.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { COMMANDS, MESSAGES } = require('../utils/constants');
const logger = require('../utils/logger');

const ID_RE = /^[0-9a-f]{24}$/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class TelegramService {
    constructor() {
        this.bot = null;
        // Health/diagnostics state, surfaced through /health. Without it a
        // remotely-deployed bot that stopped polling looks identical to a
        // healthy one from the outside.
        this.polling = false;
        this.startedAt = null;
        this.lastUpdateAt = null;
        this.launchAttempt = 0;
        this.lastError = null;
    }

    // Snapshot for /health - no secrets, safe to return publicly.
    getStatus() {
        const botInfo = this.bot && this.bot.botInfo;
        // "starting" right after boot, so a health check a second into the
        // deploy doesn't look like a dead bot.
        const state = this.polling
            ? 'running'
            : (this.lastError ? 'not-polling' : (this.startedAt ? 'stopped' : 'starting'));
        return {
            state,
            username: botInfo ? `@${botInfo.username}` : null,
            polling: this.polling,
            startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
            lastUpdateAt: this.lastUpdateAt ? new Date(this.lastUpdateAt).toISOString() : null,
            secondsSinceLastUpdate: this.lastUpdateAt
                ? Math.round((Date.now() - this.lastUpdateAt) / 1000)
                : null,
            launchAttempt: this.launchAttempt,
            lastError: this.lastError
        };
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

        // Record inbound activity before anything else so /health can tell a
        // live poller from a zombie process.
        bot.use((ctx, next) => {
            this.lastUpdateAt = Date.now();
            return next();
        });

        // ── Public commands ────────────────────────────────────
        bot.start((ctx) => botController.handleStart(ctx));
        bot.command('menu', (ctx) => botController.showMenu(ctx));
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
        bot.command('admin', authMiddleware.isAdmin, (ctx) => adminController.showHub(ctx));

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

            // ── Admin panel: a_* (screens/actions), av_* (preview),
            // ay_* (confirmed decision), an_* (request-changes note) ──
            if (prefix === 'a' || prefix === 'av' || prefix === 'ay' || prefix === 'an') {
                if (!authMiddleware.isAdminId(ctx.from.id)) {
                    logger.warn(`Unauthorized admin callback by ${ctx.from.id}: ${data}`);
                    await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
                    return;
                }

                const action = parts[1];
                const arg = parts[2];

                if (prefix === 'av') return adminController.showPreview(ctx, action);
                if (prefix === 'ay') {
                    if (!arg || !ID_RE.test(arg)) {
                        await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                        return;
                    }
                    if (action === 'ok') return adminController.handleDecision(ctx, arg, true);
                    if (action === 'no') return adminController.handleDecision(ctx, arg, false);
                    await this._answer(ctx, 'Unknown action');
                    return;
                }
                if (prefix === 'an') {
                    if (!arg || !ID_RE.test(arg)) {
                        await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                        return;
                    }
                    if (action === 'send') return adminController.sendAdminNote(ctx, arg);
                    if (action === 'cancel') return adminController.cancelAdminNote(ctx, arg);
                    await this._answer(ctx, 'Unknown action');
                    return;
                }

                switch (action) {
                    case 'hub': return adminController.showHub(ctx);
                    case 'pend': return adminController.showList(ctx, 'pending', arg);
                    case 'appr': return adminController.showList(ctx, 'approved', arg);
                    case 'rej': return adminController.showList(ctx, 'rejected', arg);
                    case 'stats': return adminController.showStats(ctx);
                    case 'users': return adminController.showUserStats(ctx);
                    case 'manage': return adminController.showManagement(ctx);
                    case 'ok':
                    case 'no': {
                        if (!arg || !ID_RE.test(arg)) {
                            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                            return;
                        }
                        return adminController.confirmDecision(ctx, arg, action === 'ok');
                    }
                    case 'ch': {
                        if (!arg || !ID_RE.test(arg)) {
                            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                            return;
                        }
                        return adminController.requestChanges(ctx, arg);
                    }
                    case 'post': {
                        if (!arg || !ID_RE.test(arg)) {
                            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                            return;
                        }
                        return adminController.postAction(ctx, arg);
                    }
                }
                await this._answer(ctx, 'Unknown action');
                return;
            }

            switch (prefix) {
                // Menu / info / profile
                case 'm': {
                    const action = parts[1];
                    if (action === 'menu') return botController.showMenu(ctx);
                    if (action === 'help') return botController.showHelp(ctx);
                    if (action === 'profile') return botController.showProfile(ctx);
                    if (action === 'nick') return botController.startNicknameChange(ctx);
                    if (action === 'activity') return botController.showActivity(ctx);
                    if (action === 'about') return botController.handleAbout(ctx);
                    if (action === 'contact') return botController.startContact(ctx);
                    break;
                }

                // Personal lists: p_conf_<page> / p_com_<page>
                case 'p': {
                    const kind = parts[1] === 'com' ? 'com' : 'conf';
                    return botController.showPersonalList(ctx, kind, parts[2]);
                }

                // Confession feed: f_browse_<page>
                case 'f': {
                    if (parts[1] !== 'browse') break;
                    return botController.browseFeed(ctx, parts[2]);
                }

                // Contact the admins: ct_send / ct_cancel
                case 'ct': {
                    if (parts[1] === 'send') return botController.sendContact(ctx);
                    if (parts[1] === 'cancel') return botController.cancelContact(ctx);
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
                        case 'back': return botController.backToTopics(ctx);
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

                // Reaction on a comment: cr_<key>_<commentId>
                case 'cr': {
                    const key = parts[1];
                    const id = parts[2];
                    if (!id || !ID_RE.test(id)) {
                        await this._answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                        return;
                    }
                    return botController.toggleReaction(ctx, key, id);
                }

                // View / hide the replies of one thread: cv_<commentId>
                case 'cv': {
                    const id = parts[1];
                    if (!id || !ID_RE.test(id)) {
                        await this._answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                        return;
                    }
                    return botController.toggleReplies(ctx, id);
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
            this.launchAttempt += 1;
            const onLaunch = () => {
                const botInfo = this.bot.botInfo;
                this.polling = true;
                this.startedAt = Date.now();
                // lastError is kept on purpose: after a recovery /health still
                // shows why polling dropped, with the time it happened.
                logger.info('🤖 Bot launched successfully (long polling)');
                logger.info(`📱 Bot Info: @${botInfo.username} (ID: ${botInfo.id})`);

                if (authMiddleware.adminIds.length) {
                    logger.info(`👮 Admin IDs configured: ${authMiddleware.adminIds.join(', ')}`);
                } else {
                    logger.warn('⚠️ No ADMIN_ID configured - admin commands will not work');
                }
            };

            // Telegraf only rejects launch() when polling dies: a revoked token
            // (401), a second instance polling the same token (409), or a
            // network fault. Exiting on all of them turns a short overlap into
            // a permanent crash loop, so retry with backoff instead.
            const MAX_ATTEMPTS = 5;
            const backoffMs = Math.min(60000, 2000 * 2 ** (this.launchAttempt - 1));

            try {
                await this.bot.launch({}, onLaunch);
            } catch (error) {
                this.polling = false;
                this.lastError = {
                    code: error.code,
                    message: error.message,
                    at: new Date().toISOString()
                };

                const isFatal = error.code === 401 || error.code === 404 ||
                    /unauthorized|not found/i.test(error.message || '');
                const attemptsLeft = MAX_ATTEMPTS - this.launchAttempt;

                if (isFatal) {
                    logger.error(`❌ Bot token rejected by Telegram (${error.message}) - fix BOT_TOKEN in the dashboard`);
                } else if (attemptsLeft <= 0) {
                    logger.error(`❌ Bot polling failed ${MAX_ATTEMPTS} times in a row - giving up: ${error.message}`);
                } else {
                    const hint = error.code === 409
                        ? 'another process is polling this same token - stop any local `npm start`, or wait for the old deploy to finish'
                        : 'transient Telegram/network failure';
                    logger.warn(`⚠️ Bot polling stopped (${error.message}) - ${hint}. Retry ${this.launchAttempt + 1}/${MAX_ATTEMPTS} in ${Math.round(backoffMs / 1000)}s`);
                    await wait(backoffMs);
                    return this.launch();
                }
                throw error;
            }

            // launch() resolving means polling was stopped deliberately.
            this.polling = false;
            return true;
        } catch (error) {
            this.polling = false;
            this.lastError = this.lastError || {
                code: error.code,
                message: error.message,
                at: new Date().toISOString()
            };
            logger.error('Failed to launch bot:', error);
            throw error;
        }
    }

    // Stop the bot gracefully
    stop() {
        if (!this.bot || !this.polling) {
            // Telegraf throws "Bot is not running!" here, which used to abort
            // the SIGTERM handler before the HTTP server was closed.
            return;
        }
        try {
            this.bot.stop();
            this.polling = false;
            logger.info('🛑 Bot stopped');
        } catch (error) {
            logger.warn(`Bot stop skipped: ${error.message}`);
        }
    }
}

module.exports = new TelegramService();

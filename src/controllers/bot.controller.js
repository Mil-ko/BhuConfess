// src/controllers/bot.controller.js
// User-facing flows: main menu, confession composition, comments, profile.
const { MESSAGES, TOPICS } = require('../utils/constants');
const keyboards = require('../utils/keyboards');
const validator = require('../utils/validator');
const logger = require('../utils/logger');
const databaseService = require('../services/database.service');
const channelService = require('../services/channel.services');
const adminController = require('./admin.controller');

const COMMENTS_PER_PAGE = 5;
const ID_RE = /^[0-9a-f]{24}$/i;

class BotController {
    /* ── plumbing ─────────────────────────────────────────────── */

    // Send a message to the user's PRIVATE chat.
    // Never use ctx.reply here: when a button on a channel post is pressed,
    // ctx.chat is the channel - and nothing except confessions may ever be
    // posted there.
    async dm(ctx, text, extra = {}) {
        try {
            return await ctx.telegram.sendMessage(ctx.from.id, text, extra);
        } catch (error) {
            logger.warn(`Failed to DM user ${ctx.from.id}: ${error.message}`);
            // Usually means the user never pressed /start on the bot
            await this.answer(ctx, '⚠️ Please open the bot and press /start first 💬');
            return null;
        }
    }

    // Answer a callback query (dismisses the button spinner).
    // Safe to call more than once - the second call just throws and is swallowed.
    async answer(ctx, text = '') {
        if (!ctx.callbackQuery) return;
        try {
            await ctx.answerCbQuery(text);
        } catch (e) {
            // query expired or already answered
        }
    }

    flow(ctx) {
        return ctx.session && ctx.session.flow;
    }

    setFlow(ctx, flow) {
        ctx.session = ctx.session || {};
        ctx.session.flow = flow;
    }

    clearFlow(ctx) {
        if (ctx.session) delete ctx.session.flow;
    }

    validId(id) {
        return typeof id === 'string' && ID_RE.test(id);
    }

    /* ── menu / info screens ──────────────────────────────────── */

    async handleStart(ctx) {
        try {
            logger.info(`User started bot: ${ctx.from.id}`);
            this.clearFlow(ctx);

            // Deep-link payload from a channel button:
            // t.me/<bot>?start=cb_<cid>_<page> or cn_new_<cid>
            // → land the user straight on the page they asked for.
            const payload = typeof ctx.startPayload === 'string' ? ctx.startPayload : '';
            if (payload && await this.handleStartPayload(ctx, payload)) {
                return;
            }

            // First time here? Ask for the nickname that will be shown with
            // their confessions and comments (instead of "Anonymous").
            const state = await databaseService.getNicknameState(ctx.from.id);
            if (!state.nickname) {
                this.setFlow(ctx, { type: 'nickname' });
                await this.dm(ctx, MESSAGES.WELCOME);
                await this.dm(ctx, MESSAGES.NICKNAME_ASK);
                return;
            }

            await this.dm(ctx, MESSAGES.WELCOME, { reply_markup: keyboards.mainMenu() });
        } catch (error) {
            logger.error('Error in handleStart:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    // Returns true when the payload was recognised and handled.
    async handleStartPayload(ctx, payload) {
        const parts = String(payload).split('_');

        // cb_<confessionId>_<page> → comments page
        if (parts[0] === 'cb' && parts[1] && ID_RE.test(parts[1])) {
            await this.browseComments(ctx, parts[1], parts[2]);
            return true;
        }

        // cn_new_<confessionId> → start the comment flow
        if (parts[0] === 'cn' && parts[1] === 'new' && parts[2] && ID_RE.test(parts[2])) {
            await this.startComment(ctx, parts[2]);
            return true;
        }

        return false;
    }

    async showMenu(ctx) {
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.MENU, { reply_markup: keyboards.mainMenu() });
    }

    async showHelp(ctx) {
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.HELP, { reply_markup: keyboards.mainMenu() });
    }

    async handleHelp(ctx) {
        return this.showHelp(ctx);
    }

    async handlePrivacy(ctx) {
        try {
            await this.dm(ctx, MESSAGES.PRIVACY, { reply_markup: keyboards.mainMenu() });
        } catch (error) {
            logger.error('Error in handlePrivacy:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    async handleAbout(ctx) {
        try {
            await this.dm(ctx, MESSAGES.ABOUT, { reply_markup: keyboards.mainMenu() });
        } catch (error) {
            logger.error('Error in handleAbout:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    async showProfile(ctx) {
        try {
            await this.answer(ctx);
            const stats = await databaseService.getAuthorStats(ctx.from.id);
            const nickState = await databaseService.getNicknameState(ctx.from.id);
            const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Unknown';
            const username = ctx.from.username ? '@' + ctx.from.username : 'No username';
            const text = MESSAGES.PROFILE
                .replace('{name}', name)
                .replace('{username}', username)
                .replace('{nickname}', nickState.nickname || 'not set yet')
                .replace('{submitted}', stats.success ? stats.submitted : '?')
                .replace('{approved}', stats.success ? stats.approved : '?');
            await this.dm(ctx, text, { reply_markup: keyboards.profile() });
        } catch (error) {
            logger.error('Error in showProfile:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    // Profile → Change nickname (cooldown enforced server side)
    async startNicknameChange(ctx) {
        try {
            const state = await databaseService.getNicknameState(ctx.from.id);
            if (state.nickname && !state.canChange) {
                const date = state.retryAt
                    ? state.retryAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : 'in 14 days';
                await this.answer(ctx, MESSAGES.NICKNAME_COOLDOWN.replace('{date}', date));
                return;
            }

            this.setFlow(ctx, { type: 'nickname', changing: !!state.nickname });
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.NICKNAME_CHANGE_PROMPT);
        } catch (error) {
            logger.error('Error in startNicknameChange:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async handleStatus(ctx) {
        try {
            if (!ctx.session || !ctx.session.lastConfessionId) {
                await this.dm(ctx,
                    '📊 You have not submitted any confession yet.\n\nTap "Send Confession" to get started.',
                    { reply_markup: keyboards.mainMenu() });
                return;
            }

            const result = await databaseService.getConfessionStatus(ctx.session.lastConfessionId);
            if (!result.success) {
                await this.dm(ctx, `❌ ${result.error}`);
                return;
            }

            const statusEmoji = { pending: '⏳', approved: '✅', rejected: '❌' };
            let line = '';
            if (result.status === 'pending') line = 'Your confession is waiting for admin review.';
            if (result.status === 'approved') line = 'Your confession was approved and published to the channel.';
            if (result.status === 'rejected') line = 'Your confession was not approved for publication.';

            await this.dm(ctx,
                `${statusEmoji[result.status]} Confession Status\n\nStatus: ${result.status.toUpperCase()}\nSubmitted: ${new Date(result.submittedAt).toLocaleString()}\nLength: ${result.length} characters\n\n${line}`,
                { reply_markup: keyboards.mainMenu() });
        } catch (error) {
            logger.error('Error in handleStatus:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    /* ── confession flow ──────────────────────────────────────── */

    async startConfession(ctx) {
        try {
            this.setFlow(ctx, { type: 'confession' });
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.TOPIC_PROMPT, { reply_markup: keyboards.topics() });
        } catch (error) {
            logger.error('Error in startConfession:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async chooseTopic(ctx, key) {
        try {
            if (!TOPICS[key]) {
                await this.answer(ctx, 'Unknown topic.');
                return;
            }
            this.setFlow(ctx, { type: 'confession', topic: key });
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.WRITE_PROMPT);
        } catch (error) {
            logger.error('Error in chooseTopic:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async editConfession(ctx) {
        const flow = this.flow(ctx);
        if (!flow || flow.type !== 'confession' || !flow.topic) {
            await this.answer(ctx, 'Your previous confession was already submitted. Start a new one.');
            return;
        }
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.EDIT_PROMPT);
    }

    async cancelConfession(ctx) {
        this.clearFlow(ctx);
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.CANCELLED, { reply_markup: keyboards.mainMenu() });
    }

    async submitConfession(ctx) {
        try {
            const flow = this.flow(ctx);
            if (!flow || flow.type !== 'confession' || !flow.text) {
                await this.answer(ctx, MESSAGES.DRAFT_EMPTY);
                return;
            }

            // Snapshot the public nickname at submission time
            const nickname = await databaseService.getNickname(ctx.from.id);

            const saveResult = await databaseService.saveConfession({
                text: flow.text,
                topic: flow.topic,
                authorId: String(ctx.from.id),
                nickname,
                metadata: {
                    hasLinks: flow.hasLinks || false,
                    messageLength: flow.text.length
                }
            });

            if (!saveResult.success) {
                logger.error('Failed to save confession:', saveResult.error);
                await this.answer(ctx, '❌ Failed to submit. Please try again.');
                return;
            }

            // Lock: draft is gone, further text is ignored until a new flow starts
            this.clearFlow(ctx);
            ctx.session = ctx.session || {};
            ctx.session.lastConfessionId = String(saveResult.id);

            await this.answer(ctx);
            await this.dm(ctx,
                MESSAGES.SUBMITTED.replace('{id}', saveResult.id),
                { reply_markup: keyboards.backToMenu() });

            // Send it to the admin review chat
            await adminController.sendForReview(ctx, saveResult.confession);
            logger.info(`✅ Confession ${saveResult.id} submitted for review by ${ctx.from.id}`);
        } catch (error) {
            logger.error('Error in submitConfession:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    /* ── text router (state machine) ──────────────────────────── */

    async handleText(ctx) {
        try {
            const flow = this.flow(ctx);
            if (!flow) {
                // No flow active - nothing is being written, show the menu
                await this.dm(ctx, MESSAGES.LOCKED, { reply_markup: keyboards.mainMenu() });
                return;
            }

            if (flow.type === 'nickname') {
                const validation = validator.validateNickname(ctx.message.text);
                if (!validation.isValid) {
                    await this.dm(ctx, MESSAGES.NICKNAME_INVALID.replace('{error}', validation.error));
                    return;
                }

                const result = await databaseService.setNickname(ctx.from.id, validation.cleaned);
                if (!result.success) {
                    if (result.error === 'cooldown') {
                        const date = result.retryAt
                            ? result.retryAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                            : 'in 14 days';
                        await this.dm(ctx, MESSAGES.NICKNAME_COOLDOWN.replace('{date}', date));
                        this.clearFlow(ctx);
                        await this.dm(ctx, MESSAGES.MENU, { reply_markup: keyboards.mainMenu() });
                        return;
                    }
                    await this.dm(ctx, MESSAGES.ERROR);
                    return;
                }

                this.clearFlow(ctx);
                await this.dm(ctx, MESSAGES.NICKNAME_SAVED.replace('{nickname}', result.nickname),
                    { reply_markup: keyboards.mainMenu() });
                return;
            }

            if (flow.type === 'confession') {
                const validation = validator.validateConfession(ctx.message.text);
                if (!validation.isValid) {
                    await this.dm(ctx, MESSAGES.INVALID_CONFESSION.replace('{error}', validation.error));
                    return;
                }
                this.setFlow(ctx, {
                    ...flow,
                    text: validator.sanitizeForDb(validation.cleaned),
                    hasLinks: validation.hasLinks
                });
                const topic = (TOPICS[flow.topic] || TOPICS.other).label;
                const preview = MESSAGES.PREVIEW_HEADER
                    .replace('{topic}', topic)
                    .replace('{text}', validation.cleaned);
                await this.dm(ctx, preview, { reply_markup: keyboards.confessionPreview() });
                return;
            }

            if (flow.type === 'comment' || flow.type === 'reply') {
                const validation = validator.validateComment(ctx.message.text);
                if (!validation.isValid) {
                    await this.dm(ctx, `❌ ${validation.error}`);
                    return;
                }
                const text = validator.sanitizeForDb(validation.cleaned);
                this.setFlow(ctx, { ...flow, text });

                if (flow.type === 'comment') {
                    const preview = MESSAGES.COMMENT_PREVIEW.replace('{text}', validation.cleaned);
                    await this.dm(ctx, preview, { reply_markup: keyboards.commentPreview(flow.cid) });
                } else {
                    const preview = MESSAGES.REPLY_PREVIEW.replace('{text}', validation.cleaned);
                    await this.dm(ctx, preview, { reply_markup: keyboards.replyPreview(flow.targetId) });
                }
                return;
            }

            // Unknown flow type
            this.clearFlow(ctx);
            await this.dm(ctx, MESSAGES.LOCKED, { reply_markup: keyboards.mainMenu() });
        } catch (error) {
            logger.error('Error in handleText:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    /* ── comments ─────────────────────────────────────────────── */

    // Paginated comment list, sent to the user's private chat.
    async browseComments(ctx, confessionId, page) {
        try {
            await this.answer(ctx);
            if (!this.validId(confessionId)) {
                await this.dm(ctx, MESSAGES.CONFESSION_NOT_FOUND, { reply_markup: keyboards.backToMenu() });
                return;
            }

            const conf = await databaseService.getConfessionById(confessionId);
            if (!conf.success) {
                await this.dm(ctx, MESSAGES.CONFESSION_NOT_FOUND, { reply_markup: keyboards.backToMenu() });
                return;
            }

            const res = await databaseService.getComments(confessionId);
            const comments = res.success ? res.comments : [];

            // Group: top-level threads, each with its one-level replies
            const top = comments.filter(c => !c.parentCommentId);
            const repliesOf = id => comments.filter(c => c.parentCommentId && String(c.parentCommentId) === String(id));
            const threads = top.map((c, i) => ({ comment: c, index: i + 1, replies: repliesOf(c._id) }));

            if (threads.length === 0) {
                await this.dm(ctx, MESSAGES.NO_COMMENTS, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✏️ Send Comment', callback_data: `cn_new_${confessionId}` }],
                            [{ text: '🏠 Main Menu', callback_data: 'm_menu' }]
                        ]
                    }
                });
                return;
            }

            const pages = Math.max(1, Math.ceil(threads.length / COMMENTS_PER_PAGE));
            let p = parseInt(page, 10);
            if (isNaN(p) || p < 0) p = 0;
            if (p > pages - 1) p = pages - 1;

            const slice = threads.slice(p * COMMENTS_PER_PAGE, (p + 1) * COMMENTS_PER_PAGE);
            const label = c => (c.nickname ? `${c.nickname}: ` : '') + c.text;
            const list = slice.map(t => {
                let s = `${t.index}. ${label(t.comment)}`;
                for (const r of t.replies) s += `\n   ↳ ${label(r)}`;
                return s;
            }).join('\n\n');

            const text = MESSAGES.COMMENTS_HEADER
                .replace('{page}', p + 1)
                .replace('{pages}', pages)
                .replace('{list}', list);

            await this.dm(ctx, text, { reply_markup: keyboards.commentsPage(confessionId, p, pages, slice) });
        } catch (error) {
            logger.error('Error in browseComments:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    async startComment(ctx, confessionId) {
        try {
            if (!this.validId(confessionId)) {
                await this.answer(ctx, MESSAGES.CONFESSION_NOT_FOUND);
                return;
            }
            const conf = await databaseService.getConfessionById(confessionId);
            if (!conf.success) {
                await this.answer(ctx, MESSAGES.CONFESSION_NOT_FOUND);
                return;
            }
            if (conf.confession.status !== 'approved') {
                await this.answer(ctx, 'This confession is not open for comments.');
                return;
            }
            this.setFlow(ctx, { type: 'comment', cid: confessionId });
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.COMMENTS_PROMPT);
        } catch (error) {
            logger.error('Error in startComment:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async submitComment(ctx, confessionId) {
        try {
            const flow = this.flow(ctx);
            if (!flow || flow.type !== 'comment' || !flow.text) {
                await this.answer(ctx, 'Write your comment first.');
                return;
            }
            const result = await databaseService.createComment({
                confessionId: flow.cid,
                authorId: String(ctx.from.id),
                nickname: await databaseService.getNickname(ctx.from.id),
                text: flow.text
            });
            if (!result.success) {
                await this.answer(ctx, `❌ ${result.error}`);
                return;
            }
            this.clearFlow(ctx);
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.COMMENT_SUBMITTED, { reply_markup: keyboards.commentDone(flow.cid, 0) });

            // Tell the confession owner about their new comment and refresh
            // the count beside Browse Comments on the channel post.
            await this.updateChannelCommentCount(ctx, flow.cid);
            await this.notifyCommentActivity(ctx, flow.cid, null, flow.text);
        } catch (error) {
            logger.error('Error in submitComment:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async cancelComment(ctx, confessionId) {
        this.clearFlow(ctx);
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.COMMENT_CANCELLED);
        await this.browseComments(ctx, confessionId, 0);
    }

    async startReply(ctx, commentId) {
        try {
            if (!this.validId(commentId)) {
                await this.answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                return;
            }
            const result = await databaseService.getCommentById(commentId);
            if (!result.success) {
                await this.answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                return;
            }
            // v1: one level only - you can reply to a top-level comment,
            // never to a reply.
            if (result.comment.parentCommentId) {
                await this.answer(ctx, 'Replies to replies are not supported.');
                return;
            }
            this.setFlow(ctx, {
                type: 'reply',
                cid: String(result.comment.confessionId),
                targetId: String(commentId)
            });
            await this.answer(ctx);
            const excerpt = result.comment.text.length > 80
                ? result.comment.text.slice(0, 80) + '…'
                : result.comment.text;
            await this.dm(ctx, MESSAGES.REPLY_PROMPT.replace('{excerpt}', excerpt));
        } catch (error) {
            logger.error('Error in startReply:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async submitReply(ctx, commentId) {
        try {
            const flow = this.flow(ctx);
            if (!flow || flow.type !== 'reply' || !flow.text) {
                await this.answer(ctx, 'Write your reply first.');
                return;
            }
            const parentId = flow.targetId || commentId;
            const result = await databaseService.createComment({
                confessionId: flow.cid,
                parentCommentId: parentId,
                authorId: String(ctx.from.id),
                nickname: await databaseService.getNickname(ctx.from.id),
                text: flow.text
            });
            if (!result.success) {
                await this.answer(ctx, `❌ ${result.error}`);
                return;
            }
            const cid = flow.cid;
            this.clearFlow(ctx);
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.REPLY_SUBMITTED, { reply_markup: keyboards.commentDone(cid, 0) });

            // Notify: confession owner (new reply) + owner of the comment
            // being replied to, then refresh the channel button count.
            await this.updateChannelCommentCount(ctx, cid);
            await this.notifyCommentActivity(ctx, cid, parentId, flow.text);
        } catch (error) {
            logger.error('Error in submitReply:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async cancelReply(ctx, commentId) {
        this.clearFlow(ctx);
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.COMMENT_CANCELLED);
        const result = await databaseService.getCommentById(commentId);
        if (result.success) {
            await this.browseComments(ctx, String(result.comment.confessionId), 0);
        }
    }

    /* ── comment activity (count + notifications) ───────────── */

    // Refresh the live comment count shown beside Browse Comments on the
    // published channel post. Never throws.
    async updateChannelCommentCount(ctx, confessionId) {
        try {
            const conf = await databaseService.getConfessionById(confessionId);
            if (!conf.success || !conf.confession.channelPostId) return;

            const res = await databaseService.getComments(confessionId);
            if (!res.success) return;

            channelService.setBot(ctx.telegram);
            await channelService.updateCommentCount(
                confessionId,
                conf.confession.channelPostId,
                res.comments.length
            );
        } catch (error) {
            logger.warn(`Could not refresh channel comment count: ${error.message}`);
        }
    }

    // Notify the right people about new activity on a confession:
    // - new comment → the confession owner
    // - new reply   → the confession owner + the owner of the replied-to comment
    // The person who triggered the event is never notified about their own
    // action, and failures (user never started the bot) are swallowed.
    async notifyCommentActivity(ctx, confessionId, parentCommentId, text) {
        try {
            const me = String(ctx.from.id);
            const snippet = text.length > 120 ? text.slice(0, 120) + '…' : text;
            const actorNickname = await databaseService.getNickname(ctx.from.id);
            const actorName = actorNickname || ctx.from.first_name || 'Someone';

            const conf = await databaseService.getConfessionById(confessionId, true);
            if (!conf.success) return;
            const ownerId = conf.confession.authorId ? String(conf.confession.authorId) : null;

            if (parentCommentId) {
                // Reply → confession owner
                if (ownerId && ownerId !== me) {
                    await adminController.notifyAuthor(ctx, ownerId,
                        MESSAGES.NOTIFY_NEW_REPLY.replace('{snippet}', snippet));
                }

                // ...and the owner of the comment that was replied to
                const parent = await databaseService.getCommentById(parentCommentId, true);
                if (parent.success && parent.comment.authorId) {
                    const parentAuthor = String(parent.comment.authorId);
                    if (parentAuthor !== me && parentAuthor !== ownerId) {
                        await adminController.notifyAuthor(ctx, parentAuthor,
                            MESSAGES.NOTIFY_REPLY_YOUR_COMMENT
                                .replace('{name}', actorName)
                                .replace('{snippet}', snippet));
                    }
                }
            } else if (ownerId && ownerId !== me) {
                // New comment → confession owner
                await adminController.notifyAuthor(ctx, ownerId,
                    MESSAGES.NOTIFY_NEW_COMMENT.replace('{snippet}', snippet));
            }
        } catch (error) {
            logger.warn(`Could not send comment notifications: ${error.message}`);
        }
    }

    /* ── errors ───────────────────────────────────────────────── */

    async handleError(ctx, error) {
        logger.error('Bot error:', error);
        const errorMessage = process.env.NODE_ENV === 'production'
            ? MESSAGES.ERROR
            : `❌ Error: ${error.message}`;
        try {
            await this.dm(ctx, errorMessage);
        } catch (e) {
            // never throw from the error handler
        }
    }
}

module.exports = new BotController();

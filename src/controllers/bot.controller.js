// src/controllers/bot.controller.js
// User-facing flows: main menu, confession composition, comments, profile.
const { MESSAGES, TOPICS, STATUS, COMMENT_UI, REACTION_EMOJI } = require('../utils/constants');
const keyboards = require('../utils/keyboards');
const commentView = require('../utils/commentView');
const validator = require('../utils/validator');
const logger = require('../utils/logger');
const databaseService = require('../services/database.service');
const channelService = require('../services/channel.services');
const authMiddleware = require('../middleware/auth.middleware');
const view = require('../utils/view');
const { clampText, timeAgo, escapeHtml } = require('../utils/format');
const adminController = require('./admin.controller');

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

    // Double-tap guard: Telegram happily delivers two callback queries when a
    // finger lands twice, and nothing here should ever run twice (a second
    // comment, a second channel post, a second notification).
    busy(ctx, key, windowMs = 1500) {
        ctx.session = ctx.session || {};
        const slot = `busy_${key}`;
        const last = ctx.session[slot] || 0;
        if (Date.now() - last < windowMs) return true;
        ctx.session[slot] = Date.now();
        return false;
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
        this.clearFlow(ctx);
        await this.dm(ctx, MESSAGES.MENU, { parse_mode: 'HTML', reply_markup: keyboards.mainMenu() });
    }

    async showHelp(ctx) {
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.HELP, { reply_markup: keyboards.help() });
    }

    async handleHelp(ctx) {
        return this.showHelp(ctx);
    }

    async handlePrivacy(ctx) {
        try {
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.PRIVACY, { reply_markup: keyboards.backToMenu() });
        } catch (error) {
            logger.error('Error in handlePrivacy:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    async handleAbout(ctx) {
        try {
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.ABOUT, { reply_markup: keyboards.about() });
        } catch (error) {
            logger.error('Error in handleAbout:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    /* ── profile & activity ───────────────────────────────────── */

    async showProfile(ctx) {
        try {
            await this.answer(ctx);
            const [activity, nickState] = await Promise.all([
                databaseService.getAuthorActivity(ctx.from.id),
                databaseService.getNicknameState(ctx.from.id)
            ]);

            const username = ctx.from.username ? '@' + ctx.from.username : '—';
            const text = MESSAGES.PROFILE
                .replace('{nickname}', nickState.nickname || '<i>not set yet</i>')
                .replace('{username}', username)
                .replace('{submitted}', activity.submitted)
                .replace('{approved}', activity.approved)
                .replace('{comments}', activity.comments + activity.replies);

            await this.dm(ctx, text, { parse_mode: 'HTML', reply_markup: keyboards.profile() });
        } catch (error) {
            logger.error('Error in showProfile:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    async showActivity(ctx) {
        try {
            await this.answer(ctx);
            const activity = await databaseService.getAuthorActivity(ctx.from.id);
            if (!activity.success) {
                await this.dm(ctx, MESSAGES.ERROR);
                return;
            }

            const text = MESSAGES.ACTIVITY
                .replace('{submitted}', activity.submitted)
                .replace('{pending}', activity.pending)
                .replace('{approved}', activity.approved)
                .replace('{rejected}', activity.rejected)
                .replace('{comments}', activity.comments)
                .replace('{replies}', activity.replies)
                .replace('{reactions}', activity.reactions);

            await this.dm(ctx, text, { parse_mode: 'HTML', reply_markup: keyboards.activity() });
        } catch (error) {
            logger.error('Error in showActivity:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    /* ── my confessions / my comments ─────────────────────────── */

    // kind: 'conf' | 'com'. Both are drawn as a paged list of blocks and
    // edited in place, exactly like the discussion screens.
    async showPersonalList(ctx, kind, page) {
        try {
            await this.answer(ctx);
            const perPage = 3;
            const isConfessions = kind === 'conf';

            const data = isConfessions
                ? await databaseService.getConfessionsByAuthor(ctx.from.id, perPage, Math.max(0, parseInt(page, 10) || 0))
                : await databaseService.getCommentsByAuthor(ctx.from.id, perPage, Math.max(0, parseInt(page, 10) || 0));

            const total = data.total || 0;
            const pages = view.pageCount(total, perPage);
            const p = view.clampPage(page, pages);

            // Re-read when the page clamp moved us (e.g. a stale button after
            // items were removed).
            if (p !== (parseInt(page, 10) || 0)) {
                return this.showPersonalList(ctx, kind, p);
            }

            const blocks = [];
            if (!total) {
                blocks.push({
                    text: isConfessions ? MESSAGES.MY_CONFESSIONS_EMPTY : MESSAGES.MY_COMMENTS_EMPTY,
                    extra: {
                        parse_mode: 'HTML',
                        reply_markup: isConfessions
                            ? { inline_keyboard: [[{ text: '✍️ Send a Confession', callback_data: 'c_start' }], [{ text: '🔙 Back', callback_data: 'm_profile' }]] }
                            : { inline_keyboard: [[{ text: '💬 Browse Confessions', callback_data: 'f_browse_0' }], [{ text: '🔙 Back', callback_data: 'm_profile' }]] }
                    }
                });
            } else {
                blocks.push({
                    text: (isConfessions ? MESSAGES.MY_CONFESSIONS_HEADER : MESSAGES.MY_COMMENTS_HEADER)
                        .replace('{page}', p + 1)
                        .replace('{pages}', pages)
                        .replace('{total}', total),
                    extra: {
                        parse_mode: 'HTML',
                        reply_markup: isConfessions
                            ? keyboards.myConfessions(p, pages)
                            : keyboards.myComments(p, pages)
                    }
                });

                if (isConfessions) {
                    const counts = await databaseService.getCommentCounts(data.confessions.map(c => String(c._id)));
                    for (const confession of data.confessions) {
                        const count = counts.counts[String(confession._id)] || 0;
                        const text = MESSAGES.MY_CONFESSION_CARD
                            .replace('{status}', MESSAGES.STATUS_LABEL[confession.status] || confession.status)
                            .replace('{when}', timeAgo(confession.createdAt))
                            .replace('{comments}', confession.status === STATUS.APPROVED
                                ? MESSAGES.MY_CONFESSION_COMMENTS.replace('{count}', count)
                                : '')
                            .replace('{text}', escapeHtml(clampText(confession.text, 600)));

                        const approved = confession.status === STATUS.APPROVED;
                        blocks.push({
                            text,
                            extra: {
                                parse_mode: 'HTML',
                                ...(approved ? { reply_markup: { inline_keyboard: [[
                                    { text: '💬 Open Discussion', callback_data: `cb_${confession._id}_0` }
                                ]] } } : {})
                            }
                        });
                    }
                } else {
                    for (const comment of data.comments) {
                        const text = MESSAGES.MY_COMMENT_CARD
                            .replace('{when}', timeAgo(comment.createdAt))
                            .replace('{text}', escapeHtml(clampText(comment.text, 400)))
                            .replace('{confession}', clampText(String(comment.confessionText || '').replace(/\s+/g, ' '), 90).replace(/</g, '&lt;') || 'this confession');
                        blocks.push({
                            text,
                            extra: {
                                parse_mode: 'HTML',
                                reply_markup: { inline_keyboard: [[
                                    { text: '💬 Open Discussion', callback_data: `cb_${comment.confessionId}_0` }
                                ]] }
                            }
                        });
                    }
                }
            }

            const key = `personal_${kind}`;
            const previous = this.personalState(ctx, kind);
            const ids = await view.replaceView(ctx, previous, blocks);
            ctx.session = ctx.session || {};
            ctx.session[key] = ids;
        } catch (error) {
            logger.error('Error in showPersonalList:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    personalState(ctx, kind) {
        const state = ctx.session && ctx.session[`personal_${kind}`];
        return Array.isArray(state) ? state : [];
    }

    /* ── confession feed ──────────────────────────────────────── */

    // Public, paginated list of approved confessions. Each card opens its
    // discussion (or starts a comment) - the same deep-linked screens the
    // channel post uses.
    async browseFeed(ctx, page) {
        try {
            await this.answer(ctx);
            const perPage = 3;
            const requested = Math.max(0, parseInt(page, 10) || 0);
            const data = await databaseService.getConfessionsPage(STATUS.APPROVED, perPage, requested);
            const total = data.total || 0;
            const pages = view.pageCount(total, perPage);
            const p = view.clampPage(page, pages);

            // Stale button after the list shrank: re-read on the real page.
            if (p !== requested) return this.browseFeed(ctx, p);

            const blocks = [];
            if (!total) {
                blocks.push({
                    text: MESSAGES.FEED_EMPTY,
                    extra: { parse_mode: 'HTML', reply_markup: keyboards.feedHeader(0, 1) }
                });
            } else {
                blocks.push({
                    text: MESSAGES.FEED_HEADER
                        .replace('{page}', p + 1)
                        .replace('{pages}', pages)
                        .replace('{total}', total),
                    extra: { parse_mode: 'HTML', reply_markup: keyboards.feedHeader(p, pages) }
                });

                const counts = await databaseService.getCommentCounts(data.confessions.map(c => String(c._id)));

                data.confessions.forEach((confession, i) => {
                    const count = counts.counts[String(confession._id)] || 0;
                    const topic = (TOPICS[confession.topic] || TOPICS.other).label;
                    blocks.push({
                        text: MESSAGES.FEED_CARD
                            .replace('{index}', p * perPage + i + 1)
                            .replace('{topic}', topic)
                            .replace('{when}', timeAgo(confession.createdAt))
                            .replace('{text}', escapeHtml(clampText(confession.text, 600)))
                            .replace('{comments}', count
                                ? `💬 ${count} ${count === 1 ? 'comment' : 'comments'}`
                                : '💬 No comments yet'),
                        extra: {
                            parse_mode: 'HTML',
                            reply_markup: keyboards.feedCard(String(confession._id))
                        }
                    });
                });
            }

            const previous = ctx.session && ctx.session.feed;
            const ids = await view.replaceView(ctx, Array.isArray(previous) ? previous : [], blocks);
            ctx.session = ctx.session || {};
            ctx.session.feed = ids;
        } catch (error) {
            logger.error('Error in browseFeed:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    /* ── contact the admins ───────────────────────────────────── */

    async startContact(ctx) {
        try {
            await this.answer(ctx);
            this.setFlow(ctx, { type: 'contact' });
            await this.dm(ctx, MESSAGES.CONTACT_PROMPT, {
                parse_mode: 'HTML',
                reply_markup: keyboards.contactCompose()
            });
        } catch (error) {
            logger.error('Error in startContact:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async sendContact(ctx) {
        try {
            const flow = this.flow(ctx);
            if (!flow || flow.type !== 'contact' || !flow.text) {
                await this.answer(ctx, '✏️ Write your message first.');
                return;
            }
            if (this.busy(ctx, 'contact')) return;

            const text = MESSAGES.CONTACT_TO_ADMIN.replace('{text}', escapeHtml(flow.text));
            let delivered = 0;
            for (const adminId of (authMiddleware.adminIds || [])) {
                try {
                    await ctx.telegram.sendMessage(adminId, text, { parse_mode: 'HTML' });
                    delivered += 1;
                } catch (error) {
                    logger.warn(`Could not deliver contact message to ${adminId}: ${error.message}`);
                }
            }

            this.clearFlow(ctx);
            await this.answer(ctx, delivered ? '📤 Sent' : '⚠️ Not delivered');
            await this.dm(ctx, delivered ? MESSAGES.CONTACT_SENT : MESSAGES.CONTACT_FAILED, {
                reply_markup: keyboards.backToMenu()
            });
        } catch (error) {
            logger.error('Error in sendContact:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    async cancelContact(ctx) {
        this.clearFlow(ctx);
        await this.answer(ctx, '👌 Cancelled');
        await this.dm(ctx, MESSAGES.MENU, { parse_mode: 'HTML', reply_markup: keyboards.mainMenu() });
    }

    // 🔙 Back from "write a confession" to the topic list.
    async backToTopics(ctx) {
        const flow = this.flow(ctx);
        if (!flow || flow.type !== 'confession') {
            await this.showMenu(ctx);
            return;
        }
        await this.answer(ctx);
        await this.dm(ctx, MESSAGES.TOPIC_PROMPT, { reply_markup: keyboards.topics() });
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
            // A new draft is a new submission: clear the double-tap guard that
            // protects the previous one.
            if (ctx.session) delete ctx.session.busy_submit_confession;
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

            // A double tap must never create two confessions.
            if (this.busy(ctx, 'submit_confession', 5000)) return;
            await this.answer(ctx, '⏳ Submitting…');

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
                await this.dm(ctx, MESSAGES.LOCKED, { parse_mode: 'HTML', reply_markup: keyboards.mainMenu() });
                return;
            }

            // Admin "request changes" note: routed here because it is a text
            // draft like any other, but the permission check happens there.
            if (flow.type === 'adminNote') {
                await adminController.handleAdminNoteText(ctx, flow);
                return;
            }

            if (flow.type === 'contact') {
                const text = String(ctx.message.text || '').trim();
                if (text.length < 10) {
                    await this.dm(ctx, '✏️ Please write at least 10 characters so the admins can help you.');
                    return;
                }
                if (text.length > 1000) {
                    await this.dm(ctx, '✂️ Please keep it under 1000 characters.');
                    return;
                }
                this.setFlow(ctx, { ...flow, text: validator.sanitizeForDb(text) });
                await this.dm(ctx, MESSAGES.CONTACT_PREVIEW.replace('{text}', escapeHtml(text)), {
                    parse_mode: 'HTML',
                    reply_markup: keyboards.contactPreview()
                });
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
                    .replace('{text}', escapeHtml(validation.cleaned));
                await this.dm(ctx, preview, {
                    parse_mode: 'HTML',
                    reply_markup: keyboards.confessionPreview()
                });
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
                    const block = commentView.commentPreviewBlock({ text: validation.cleaned, cid: flow.cid });
                    await this.dm(ctx, block.text, block.extra);
                } else {
                    // Show what is being answered right above the draft, so the
                    // reply can never be posted against the wrong comment.
                    const target = await databaseService.getCommentById(flow.targetCommentId || flow.targetId, true);
                    const comments = await databaseService.getComments(flow.cid, true);
                    const names = await this.namesFor(comments.success ? comments.comments : []);
                    const block = commentView.replyPreviewBlock({
                        name: target.success ? commentView.nameOf(names, target.comment.authorId) : 'this comment',
                        excerpt: target.success ? target.comment.text : '',
                        text: validation.cleaned,
                        commentId: flow.targetId
                    });
                    await this.dm(ctx, block.text, block.extra);
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

    /* ── discussion view: rendering plumbing ──────────────────── */

    // The view currently on the reader's screen: the message ids this bot owns,
    // so Prev/Next can edit those messages in place instead of flooding the chat.
    discussionState(ctx) {
        const state = ctx.session && ctx.session.discussion;
        return state && Array.isArray(state.messageIds) && state.messageIds.length ? state : null;
    }

    saveDiscussion(ctx, state) {
        ctx.session = ctx.session || {};
        ctx.session.discussion = state;
    }

    // Which threads are expanded (replies visible) in this discussion.
    expandedIds(ctx, confessionId) {
        const expanded = ctx.session && ctx.session.expanded;
        return expanded && expanded.cid === String(confessionId) ? expanded.ids : [];
    }

    saveExpanded(ctx, confessionId, ids) {
        ctx.session = ctx.session || {};
        ctx.session.expanded = { cid: String(confessionId), ids: ids.map(String) };
    }

    async deleteMessages(ctx, ids = []) {
        for (const id of ids) {
            try {
                await ctx.telegram.deleteMessage(ctx.from.id, id);
            } catch (error) {
                // already gone, or too old for the bot to touch - nothing to do
            }
        }
    }

    // Draw blocks as the current view: edit the previous view where it still
    // exists, send what is new, delete what is left over.
    async drawBlocks(ctx, previousIds, blocks) {
        const ids = [];

        for (let i = 0; i < blocks.length; i++) {
            const messageId = previousIds[i];
            if (messageId) {
                try {
                    await ctx.telegram.editMessageText(
                        ctx.from.id, messageId, undefined, blocks[i].text, blocks[i].extra
                    );
                    ids.push(messageId);
                    continue;
                } catch (error) {
                    // past Telegram's edit window or deleted: send a fresh one
                }
            }
            try {
                const sent = await ctx.telegram.sendMessage(ctx.from.id, blocks[i].text, blocks[i].extra);
                ids.push(sent.message_id);
            } catch (error) {
                logger.warn(`Could not render discussion block: ${error.message}`);
            }
        }

        await this.deleteMessages(ctx, previousIds.slice(blocks.length));
        return ids;
    }

    // One stable display name per person across the whole discussion.
    async namesFor(comments) {
        const ids = [...new Set(comments.map(c => c.authorId).filter(Boolean).map(String))];
        let nicknames = {};
        if (ids.length) {
            const res = await databaseService.getNicknames(ids);
            if (res.success) nicknames = res.nicknames;
        }
        return commentView.resolveNames(comments, nicknames);
    }

    // Page (0-based) that holds a given thread - used after posting.
    async threadPage(confessionId, threadId) {
        const res = await databaseService.getComments(confessionId, true);
        const threads = commentView.buildThreads(res.success ? res.comments : []);
        const position = threads.findIndex(t => String(t.comment._id) === String(threadId));
        return position < 0 ? 0 : Math.floor(position / COMMENT_UI.PER_PAGE);
    }

    // Re-render a single card in place (reaction or expand/collapse).
    async refreshCard(ctx, commentId) {
        const target = await databaseService.getCommentById(commentId, true);
        if (!target.success) return false;

        const cid = String(target.comment.confessionId);
        const rootId = target.comment.parentCommentId
            ? String(target.comment.parentCommentId)
            : String(target.comment._id);

        const res = await databaseService.getComments(cid, true);
        const comments = res.success ? res.comments : [];
        const thread = commentView.buildThreads(comments).find(t => String(t.comment._id) === rootId);
        if (!thread) return false;

        const names = await this.namesFor(comments);
        const expanded = new Set(this.expandedIds(ctx, cid));
        const block = commentView.cardBlock({
            index: thread.index,
            comment: thread.comment,
            replies: thread.replies,
            names,
            expanded: expanded.has(rootId),
            viewerId: ctx.from.id
        });

        const messageId = this.cardMessageId(ctx, thread, cid);
        if (messageId) {
            try {
                await ctx.telegram.editMessageText(ctx.from.id, messageId, undefined, block.text, block.extra);
                return true;
            } catch (error) {
                // too old to edit / deleted - re-send below
            }
        }

        try {
            const sent = await ctx.telegram.sendMessage(ctx.from.id, block.text, block.extra);
            const state = this.discussionState(ctx);
            if (state && state.cid === cid) state.messageIds.push(sent.message_id);
        } catch (error) {
            logger.warn(`Could not refresh comment card: ${error.message}`);
        }
        return true;
    }

    // The message currently showing this card: the one the button was pressed
    // on, or the slot recorded when the page was drawn (slot 0 = header).
    cardMessageId(ctx, thread, cid) {
        const tapped = ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id;
        if (tapped) return tapped;

        const state = this.discussionState(ctx);
        if (!state || state.cid !== String(cid)) return null;

        const positionInPage = thread.index - 1 - state.page * COMMENT_UI.PER_PAGE;
        if (positionInPage < 0) return null;
        return state.messageIds[positionInPage + 1] || null;
    }

    /* ── discussion view ──────────────────────────────────────── */

    // Header + one card per top-level comment, all in the reader's private chat.
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

            const res = await databaseService.getComments(confessionId, true);
            const comments = res.success ? res.comments : [];
            const names = await this.namesFor(comments);
            const threads = commentView.buildThreads(comments);
            const pages = Math.max(1, Math.ceil(threads.length / COMMENT_UI.PER_PAGE));

            let p = parseInt(page, 10);
            if (isNaN(p) || p < 0) p = 0;
            if (p > pages - 1) p = pages - 1;

            const slice = threads.slice(p * COMMENT_UI.PER_PAGE, (p + 1) * COMMENT_UI.PER_PAGE);
            const expanded = new Set(this.expandedIds(ctx, confessionId));

            const blocks = [];
            if (!threads.length) {
                blocks.push(commentView.emptyBlock({ confession: conf.confession, cid: confessionId }));
            } else {
                blocks.push(commentView.headerBlock({
                    confession: conf.confession,
                    cid: confessionId,
                    page: p,
                    pages,
                    count: comments.length
                }));
                for (const thread of slice) {
                    blocks.push(commentView.cardBlock({
                        index: thread.index,
                        comment: thread.comment,
                        replies: thread.replies,
                        names,
                        expanded: expanded.has(String(thread.comment._id)),
                        viewerId: ctx.from.id
                    }));
                }
            }

            // A view of a DIFFERENT confession is a different screen: drop it
            // rather than editing unrelated messages.
            const previous = this.discussionState(ctx);
            let previousIds = [];
            if (previous && previous.cid === String(confessionId)) {
                previousIds = previous.messageIds;
            } else if (previous) {
                await this.deleteMessages(ctx, previous.messageIds);
                delete ctx.session.discussion;
            }

            const messageIds = await this.drawBlocks(ctx, previousIds, blocks);
            this.saveDiscussion(ctx, { cid: String(confessionId), page: p, messageIds });
        } catch (error) {
            logger.error('Error in browseComments:', error);
            await this.dm(ctx, MESSAGES.ERROR);
        }
    }

    // ❤️ 😂 🔥 👍 - one tap adds, a second tap removes.
    async toggleReaction(ctx, key, commentId) {
        try {
            if (!commentView.REACTION_KEYS.includes(key) || !this.validId(commentId)) {
                await this.answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                return;
            }

            const result = await databaseService.toggleReaction(commentId, ctx.from.id, key);
            if (!result.success) {
                await this.answer(ctx, '❌ Could not save that reaction.');
                return;
            }

            await this.refreshCard(ctx, commentId);
            await this.answer(ctx, `${REACTION_EMOJI[key]} ${result.reacted ? 'added' : 'removed'}`);
        } catch (error) {
            logger.error('Error in toggleReaction:', error);
            await this.answer(ctx, MESSAGES.ERROR);
        }
    }

    // View replies / hide replies for one thread (in place, same card).
    async toggleReplies(ctx, commentId) {
        try {
            if (!this.validId(commentId)) {
                await this.answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                return;
            }

            const target = await databaseService.getCommentById(commentId, true);
            if (!target.success) {
                await this.answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                return;
            }

            const cid = String(target.comment.confessionId);
            const expanded = new Set(this.expandedIds(ctx, cid));
            const key = String(commentId);

            if (expanded.has(key)) expanded.delete(key);
            else expanded.add(key);

            this.saveExpanded(ctx, cid, [...expanded]);
            await this.refreshCard(ctx, commentId);
            await this.answer(ctx);
        } catch (error) {
            logger.error('Error in toggleReplies:', error);
            await this.answer(ctx, MESSAGES.ERROR);
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
            // The button carries the confession id: it must match the draft the
            // user actually wrote, or a stale button could post to the wrong one.
            if (String(flow.cid) !== String(confessionId)) {
                this.clearFlow(ctx);
                await this.answer(ctx, '❌ That comment target changed. Open the discussion again.');
                return;
            }

            const cid = flow.cid;
            const text = flow.text;
            const result = await databaseService.createComment({
                confessionId: cid,
                authorId: String(ctx.from.id),
                nickname: await databaseService.getNickname(ctx.from.id),
                text
            });
            if (!result.success) {
                await this.answer(ctx, `❌ ${result.error}`);
                return;
            }

            this.clearFlow(ctx);
            await this.answer(ctx);
            await this.dm(ctx, MESSAGES.COMMENT_SUBMITTED);

            // Tell the confession owner about their new comment and refresh
            // the count beside Browse Comments on the channel post.
            await this.updateChannelCommentCount(ctx, cid);
            await this.notifyCommentActivity(ctx, cid, { text });

            // Land on the page that now holds the new comment.
            await this.browseComments(ctx, cid, await this.threadPage(cid, String(result.comment._id)));
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

            const target = await databaseService.getCommentById(commentId, true);
            if (!target.success) {
                await this.answer(ctx, MESSAGES.COMMENT_NOT_FOUND);
                return;
            }

            const cid = String(target.comment.confessionId);
            const conf = await databaseService.getConfessionById(cid);
            if (!conf.success || conf.confession.status !== STATUS.APPROVED) {
                await this.answer(ctx, 'This confession is not open for comments.');
                return;
            }

            // Replies always hang off the thread's TOP-LEVEL comment, so the
            // discussion stays one level deep. The exact comment being answered
            // is kept separately (context screen + notification) - that is how
            // replying to a reply works without nesting deeper.
            const rootId = target.comment.parentCommentId
                ? String(target.comment.parentCommentId)
                : String(commentId);
            const root = rootId === String(commentId)
                ? target.comment
                : (await databaseService.getCommentById(rootId, true)).comment;

            if (!root || String(root.confessionId) !== cid || root.parentCommentId) {
                await this.answer(ctx, '❌ That comment belongs to a different discussion.');
                return;
            }

            this.setFlow(ctx, {
                type: 'reply',
                cid,
                targetId: rootId,
                targetCommentId: String(commentId)
            });

            // Show the comment being answered BEFORE asking for the reply.
            const comments = await databaseService.getComments(cid, true);
            const names = await this.namesFor(comments.success ? comments.comments : []);
            const block = commentView.replyContextBlock({
                name: commentView.nameOf(names, target.comment.authorId),
                text: target.comment.text,
                commentId: String(commentId)
            });

            await this.answer(ctx);
            await this.dm(ctx, block.text, block.extra);
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

            // Re-check the target instead of trusting the draft or the button:
            // it must still exist, still belong to this confession and still be
            // a top-level comment. A reply can never land on the wrong thread.
            const parentId = flow.targetId || commentId;
            const parent = await databaseService.getCommentById(parentId);
            if (!parent.success) {
                this.clearFlow(ctx);
                await this.answer(ctx, '❌ The comment you were replying to no longer exists.');
                return;
            }
            if (String(parent.comment.confessionId) !== String(flow.cid) || parent.comment.parentCommentId) {
                this.clearFlow(ctx);
                await this.answer(ctx, '❌ That reply target changed. Open the discussion and tap Reply again.');
                return;
            }

            const addressedId = flow.targetCommentId && String(flow.targetCommentId) !== String(parentId)
                ? String(flow.targetCommentId)
                : null;

            const cid = flow.cid;
            const text = flow.text;
            const result = await databaseService.createComment({
                confessionId: cid,
                parentCommentId: parentId,
                replyToCommentId: addressedId,
                authorId: String(ctx.from.id),
                nickname: await databaseService.getNickname(ctx.from.id),
                text
            });
            if (!result.success) {
                await this.answer(ctx, `❌ ${result.error}`);
                return;
            }

            this.clearFlow(ctx);
            await this.answer(ctx);

            // Reopen the thread that was answered, with its replies visible.
            const expanded = new Set(this.expandedIds(ctx, cid));
            expanded.add(String(parentId));
            this.saveExpanded(ctx, cid, [...expanded]);

            await this.dm(ctx, MESSAGES.REPLY_SUBMITTED);

            // Notify: confession owner (new reply), the thread owner and the
            // author of the specific comment that was answered.
            await this.updateChannelCommentCount(ctx, cid);
            await this.notifyCommentActivity(ctx, cid, { parentId: String(parentId), replyToId: addressedId, text });

            await this.browseComments(ctx, cid, await this.threadPage(cid, parentId));
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
        if (!result.success) {
            await this.dm(ctx, MESSAGES.MENU, { reply_markup: keyboards.mainMenu() });
            return;
        }

        const cid = String(result.comment.confessionId);
        const rootId = result.comment.parentCommentId
            ? String(result.comment.parentCommentId)
            : String(commentId);
        await this.browseComments(ctx, cid, await this.threadPage(cid, rootId));
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
    // - new reply   → the confession owner, the thread's comment owner and the
    //                 author of the exact comment that was answered
    // The person who triggered the event is never notified about their own
    // action, nobody is notified twice, and failures (user never started the
    // bot) are swallowed.
    async notifyCommentActivity(ctx, confessionId, { parentId = null, replyToId = null, text = '' } = {}) {
        try {
            const me = String(ctx.from.id);
            const snippet = text.length > 120 ? text.slice(0, 120) + '…' : text;
            const actorNickname = await databaseService.getNickname(ctx.from.id);
            const actorName = actorNickname || ctx.from.first_name || 'Someone';

            const conf = await databaseService.getConfessionById(confessionId, true);
            if (!conf.success) return;
            const ownerId = conf.confession.authorId ? String(conf.confession.authorId) : null;

            const targets = new Map(); // telegram id → message
            const addTarget = (id, message) => {
                if (!id) return;
                const key = String(id);
                if (!targets.has(key)) targets.set(key, message);
            };
            const repliedToYours = () => MESSAGES.NOTIFY_REPLY_YOUR_COMMENT
                .replace('{name}', actorName)
                .replace('{snippet}', snippet);

            if (parentId) {
                // Reply → confession owner
                if (ownerId) addTarget(ownerId, MESSAGES.NOTIFY_NEW_REPLY.replace('{snippet}', snippet));

                // ...the owner of the thread's top-level comment...
                const root = await databaseService.getCommentById(parentId, true);
                if (root.success) addTarget(root.comment.authorId, repliedToYours());

                // ...and whoever wrote the exact comment that was answered.
                if (replyToId && String(replyToId) !== String(parentId)) {
                    const addressed = await databaseService.getCommentById(replyToId, true);
                    if (addressed.success) addTarget(addressed.comment.authorId, repliedToYours());
                }
            } else if (ownerId) {
                // New comment → confession owner
                addTarget(ownerId, MESSAGES.NOTIFY_NEW_COMMENT.replace('{snippet}', snippet));
            }

            targets.delete(me);
            for (const [id, message] of targets) {
                await adminController.notifyAuthor(ctx, id, message);
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

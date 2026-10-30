// src/controllers/admin.controller.js
// Admin review: send confessions for review, approve/reject with buttons,
// notify the author, publish approved confessions to the channel.
const { MESSAGES, STATUS, TOPICS } = require('../utils/constants');
const keyboards = require('../utils/keyboards');
const logger = require('../utils/logger');
const databaseService = require('../services/database.service');
const channelService = require('../services/channel.services.js');
const authMiddleware = require('../middleware/auth.middleware');
const view = require('../utils/view');
const { clampText, timeAgo, escapeHtml } = require('../utils/format');

const ID_RE = /^[0-9a-f]{24}$/i;
const LIST_PAGE_SIZE = 3;

class AdminController {
    /* ── review flow ──────────────────────────────────────────── */

    // Send a new confession to EVERY configured admin for review.
    async sendForReview(ctx, confession) {
        const topic = (TOPICS[confession.topic] || TOPICS.other).label;
        const text = MESSAGES.ADMIN.REVIEW_HEADER
            .replace('{id}', String(confession._id))
            .replace('{topic}', topic)
            .replace('{date}', new Date(confession.createdAt || Date.now()).toLocaleString())
            .replace('{text}', escapeHtml(confession.text));

        for (const adminId of authMiddleware.adminIds) {
            try {
                await ctx.telegram.sendMessage(adminId, text, {
                    parse_mode: 'HTML',
                    reply_markup: keyboards.adminReview(String(confession._id))
                });
            } catch (error) {
                logger.error(`Failed to send review to admin ${adminId}:`, error);
            }
        }
    }

    /* ── admin panel ──────────────────────────────────────────── */

    // Tiny double-tap guard, same idea as the user side.
    _busy(ctx, key, windowMs = 2000) {
        ctx.session = ctx.session || {};
        const slot = `admin_busy_${key}`;
        const last = ctx.session[slot] || 0;
        if (Date.now() - last < windowMs) return true;
        ctx.session[slot] = Date.now();
        return false;
    }

    _allowed(ctx) {
        return authMiddleware.isAdminId(ctx.from.id);
    }

    async _send(ctx, text, markup = null) {
        try {
            await ctx.telegram.sendMessage(ctx.from.id, text, markup
                ? { parse_mode: 'HTML', reply_markup: markup }
                : { parse_mode: 'HTML' });
        } catch (error) {
            logger.warn(`Could not send admin screen: ${error.message}`);
        }
    }

    // 🛠️ Admin Panel - the single entry point for every admin screen
    async showHub(ctx) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        await this._answer(ctx);

        const stats = await databaseService.getStats();
        const counts = stats.success ? stats.stats : {};
        const text = MESSAGES.ADMIN.HUB
            .replace('{pending}', counts.pending != null ? counts.pending : '?')
            .replace('{approved}', counts.approved != null ? counts.approved : '?')
            .replace('{rejected}', counts.rejected != null ? counts.rejected : '?')
            .replace('{total}', counts.total != null ? counts.total : '?');

        await this._send(ctx, text, keyboards.adminHub(counts));
    }

    // 📥 / ✅ / ❌ - one card per confession, paged, with its actions
    async showList(ctx, list, page) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        await this._answer(ctx);

        const kind = ['pending', 'approved', 'rejected'].includes(list) ? list : 'pending';
        const status = kind === 'pending' ? STATUS.PENDING
            : (kind === 'approved' ? STATUS.APPROVED : STATUS.REJECTED);
        const requested = Math.max(0, parseInt(page, 10) || 0);

        const data = await databaseService.getConfessionsPage(status, LIST_PAGE_SIZE, requested);
        const total = data.total || 0;
        const pages = view.pageCount(total, LIST_PAGE_SIZE);
        const p = view.clampPage(page, pages);

        if (p !== requested) return this.showList(ctx, kind, p);

        const blocks = [];
        if (!total) {
            blocks.push({
                text: kind === 'pending' ? MESSAGES.ADMIN.EMPTY_PENDING
                    : (kind === 'approved' ? MESSAGES.ADMIN.EMPTY_APPROVED : MESSAGES.ADMIN.EMPTY_REJECTED),
                extra: {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]] }
                }
            });
        } else {
            const header = kind === 'pending' ? MESSAGES.ADMIN.LIST_PENDING
                : (kind === 'approved' ? MESSAGES.ADMIN.LIST_APPROVED : MESSAGES.ADMIN.LIST_REJECTED);

            blocks.push({
                text: header.replace('{page}', p + 1).replace('{pages}', pages),
                extra: { parse_mode: 'HTML', reply_markup: keyboards.adminListFor(kind, p, pages) }
            });

            for (const confession of data.confessions) {
                blocks.push({
                    text: this.listCardText(confession),
                    extra: {
                        parse_mode: 'HTML',
                        reply_markup: kind === 'pending'
                            ? keyboards.adminReview(String(confession._id))
                            : keyboards.adminArchiveItem(confession)
                    }
                });
            }
        }

        const key = `admin_list_${kind}`;
        const previous = ctx.session && ctx.session[key];
        const ids = await view.replaceView(ctx, Array.isArray(previous) ? previous : [], blocks);
        ctx.session = ctx.session || {};
        ctx.session[key] = ids;
    }

    listCardText(confession) {
        const status = MESSAGES.STATUS_LABEL[confession.status] || confession.status;
        const topic = (TOPICS[confession.topic] || TOPICS.other).label;
        const extra = confession.channelPostId
            ? `\n📢 <i>posted to the channel</i>`
            : '';
        return `${status} · ${topic} · <i>${timeAgo(confession.createdAt)}</i>${extra}\n` +
            `<blockquote>${escapeHtml(clampText(confession.text, 400))}</blockquote>`;
    }

    // 👁️ Full confession, with the actions that fit its status.
    async showPreview(ctx, confessionId) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        if (!ID_RE.test(confessionId)) {
            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
            return;
        }
        await this._answer(ctx);

        const result = await databaseService.getConfessionById(confessionId);
        if (!result.success) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_FOUND);
            return;
        }

        const confession = result.confession;
        const topic = (TOPICS[confession.topic] || TOPICS.other).label;
        const counts = await databaseService.getCommentCounts([String(confession._id)]);
        const commentCount = counts.counts[String(confession._id)] || 0;

        const text = MESSAGES.ADMIN.PREVIEW
            .replace('{status}', MESSAGES.STATUS_LABEL[confession.status] || confession.status)
            .replace('{topic}', topic)
            .replace('{date}', new Date(confession.createdAt).toLocaleString())
            .replace('{id}', String(confession._id))
            .replace('{text}', escapeHtml(confession.text))
            .replace('{comments}', commentCount
                ? `💬 ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`
                : '💬 No comments yet');

        await this._send(ctx, text, keyboards.adminPreviewActions(confession));
    }

    // ✅ / ❌ first tap → confirmation, never an immediate decision.
    async confirmDecision(ctx, confessionId, approve) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        if (!ID_RE.test(confessionId)) {
            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
            return;
        }

        const result = await databaseService.getConfessionById(confessionId);
        if (!result.success) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_FOUND);
            return;
        }
        const confession = result.confession;
        if (confession.status !== STATUS.PENDING) {
            await this._answer(ctx, MESSAGES.ADMIN.ALREADY_HANDLED);
            return;
        }

        await this._answer(ctx);
        const template = approve ? MESSAGES.ADMIN.CONFIRM_APPROVE : MESSAGES.ADMIN.CONFIRM_REJECT;
        const text = template.replace('{excerpt}', escapeHtml(clampText(confession.text, 350)));
        const markup = keyboards.adminConfirm(confessionId, approve ? 'ok' : 'no');

        const messageId = ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id;
        const id = await view.editOrSend(ctx, messageId, text, { parse_mode: 'HTML', reply_markup: markup });
        if (id) ctx.session.adminConfirm = { id: String(confessionId), messageId: id, approve };
    }

    // ✏️ Request changes: collect a note for the author, then send it.
    async requestChanges(ctx, confessionId) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        if (!ID_RE.test(confessionId)) {
            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
            return;
        }

        const result = await databaseService.getConfessionById(confessionId);
        if (!result.success) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_FOUND);
            return;
        }
        if (result.confession.status !== STATUS.PENDING) {
            await this._answer(ctx, MESSAGES.ADMIN.ALREADY_HANDLED);
            return;
        }

        ctx.session = ctx.session || {};
        ctx.session.flow = { type: 'adminNote', id: String(confessionId) };
        await this._answer(ctx);
        await this._send(ctx, MESSAGES.ADMIN.CONFIRM_CHANGES, {
            inline_keyboard: [[{ text: '🗑️ Cancel', callback_data: `an_cancel_${confessionId}` }]]
        });
    }

    // Text draft for a "request changes" note (routed from bot.controller).
    async handleAdminNoteText(ctx, flow) {
        if (!this._allowed(ctx)) {
            ctx.session.flow = undefined;
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }

        const note = String(ctx.message.text || '').trim();
        if (note.length < 10) {
            await this._send(ctx, '✏️ Please write at least 10 characters so the author knows what to change.');
            return;
        }
        if (note.length > 500) {
            await this._send(ctx, '✂️ Please keep the note under 500 characters.');
            return;
        }

        ctx.session.flow = { ...flow, note };
        await this._send(ctx, MESSAGES.ADMIN.CHANGES_PREVIEW.replace('{note}', escapeHtml(note)),
            keyboards.adminChangesPreview(flow.id));
    }

    // 📤 Send the note to the author; the confession stays unpublished.
    async sendAdminNote(ctx, confessionId) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }

        const flow = ctx.session && ctx.session.flow;
        if (!flow || flow.type !== 'adminNote' || !flow.note || String(flow.id) !== String(confessionId)) {
            await this._answer(ctx, '⚠️ Write the note first.');
            return;
        }
        if (this._busy(ctx, 'note')) return;

        const result = await databaseService.getConfessionById(confessionId, true);
        if (!result.success) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_FOUND);
            return;
        }

        const note = flow.note;
        ctx.session.flow = undefined;

        await databaseService.updateConfessionStatus(confessionId, STATUS.PENDING, String(ctx.from.id), note);
        await this.notifyAuthor(ctx, result.confession.authorId,
            MESSAGES.ADMIN.NOTIFY_CHANGES.replace('{note}', note));

        await this._answer(ctx, '📤 Note sent');
        await this._send(ctx, MESSAGES.ADMIN.CHANGES_SENT, {
            inline_keyboard: [[{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]]
        });
    }

    async cancelAdminNote(ctx, confessionId) {
        if (ctx.session) ctx.session.flow = undefined;
        await this._answer(ctx, '👌 Cancelled');
        await this.showPreview(ctx, String(confessionId));
    }

    // 📢 Publish an already approved confession (or repost it).
    async postAction(ctx, confessionId) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        if (!ID_RE.test(confessionId)) {
            await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
            return;
        }
        if (this._busy(ctx, 'post')) return;
        await this._answer(ctx, '⏳ Publishing…');

        const result = await databaseService.getConfessionById(confessionId);
        if (!result.success) {
            await this._send(ctx, MESSAGES.ADMIN.NOT_FOUND);
            return;
        }
        if (result.confession.status !== STATUS.APPROVED) {
            await this._send(ctx, '⚠️ Only approved confessions can be posted.');
            return;
        }

        const published = await this.publishToChannel(ctx, confessionId, result.confession);
        await this._send(ctx, published.text, {
            inline_keyboard: [[{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]]
        });
    }

    // 📊 Bot statistics
    async showStats(ctx) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        await this._answer(ctx);

        const stats = await databaseService.getStats();
        if (!stats.success) {
            await this._send(ctx, '❌ Failed to get statistics');
            return;
        }
        const s = stats.stats;
        const text = `📊 <b>Bot Statistics</b>\n\n🗂️ Total: <b>${s.total}</b>\n📥 Pending: ${s.pending}\n✅ Approved: ${s.approved}\n❌ Rejected: ${s.rejected}\n\n<i>Use the buttons below to act on them.</i>`;
        await this._send(ctx, text, keyboards.adminStats());
    }

    // 👥 User statistics
    async showUserStats(ctx) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        await this._answer(ctx);

        const stats = await databaseService.getUserStats();
        const top = stats.top && stats.top.length
            ? stats.top.map(row => `${row.rank}. ${escapeHtml(row.name)} — ${row.count}`).join('\n')
            : MESSAGES.ADMIN.NO_TOP;

        const text = MESSAGES.ADMIN.USER_STATS
            .replace('{users}', stats.users)
            .replace('{nicknames}', stats.nicknames)
            .replace('{avg}', stats.average)
            .replace('{comments}', stats.comments)
            .replace('{reactions}', stats.reactions)
            .replace('{top}', top);

        await this._send(ctx, text, keyboards.adminUsers());
    }

    // ⚙️ Bot management - live status of everything that can break
    async showManagement(ctx) {
        if (!this._allowed(ctx)) {
            await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
            return;
        }
        await this._answer(ctx, '🔄');

        let botName = 'unknown';
        try {
            const me = await ctx.telegram.getMe();
            botName = `@${me.username}`;
        } catch (error) {
            logger.warn(`getMe failed on admin screen: ${error.message}`);
        }

        const health = await databaseService.healthCheck();
        const uptimeMinutes = Math.floor(process.uptime() / 60);
        const uptime = uptimeMinutes >= 60
            ? `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`
            : `${uptimeMinutes}m`;

        const text = MESSAGES.ADMIN.MANAGE
            .replace('{bot}', botName)
            .replace('{channel}', channelService.channelId || '<i>not set</i>')
            .replace('{db}', health.isConnected ? '✅ connected' : `❌ ${health.dbStatus || 'down'}`)
            .replace('{uptime}', uptime)
            .replace('{keepalive}', process.env.KEEPALIVE === 'true' ? '✅ on' : 'off');

        await this._send(ctx, text, keyboards.adminManage());
    }

    // Approve / reject button handler.
    // Permission is checked SERVER SIDE on every call.
    async handleDecision(ctx, confessionId, approve) {
        try {
            if (!authMiddleware.isAdminId(ctx.from.id)) {
                logger.warn(`Unauthorized decision attempt by user ${ctx.from.id}`);
                await this._answer(ctx, MESSAGES.ADMIN.NOT_ADMIN);
                return;
            }

            if (!ID_RE.test(confessionId)) {
                await this._answer(ctx, MESSAGES.ADMIN.INVALID_ID);
                return;
            }

            // Include authorId: it is needed for the private notification
            const result = await databaseService.getConfessionById(confessionId, true);
            if (!result.success) {
                await this._answer(ctx, MESSAGES.ADMIN.NOT_FOUND);
                return;
            }

            const confession = result.confession;

            if (confession.status !== STATUS.PENDING) {
                await this._answer(ctx, MESSAGES.ADMIN.ALREADY_HANDLED);
                return;
            }

            const newStatus = approve ? STATUS.APPROVED : STATUS.REJECTED;
            const update = await databaseService.updateConfessionStatus(
                confessionId,
                newStatus,
                String(ctx.from.id)
            );
            if (!update.success) {
                await this._answer(ctx, MESSAGES.ADMIN.ERROR);
                return;
            }

            // Approve → publish to the channel (reject → nothing goes out)
            let resultText;
            let channelPostId = null;
            if (approve) {
                const published = await this.publishToChannel(ctx, confessionId, update.confession);
                resultText = published.text;
                channelPostId = published.messageId;
            } else {
                resultText = MESSAGES.ADMIN.REVIEW_DONE_REJECTED;
            }

            // Notify the AUTHOR (and only the author) of the decision.
            // On approval, attach a button straight to the published post.
            const notification = approve ? MESSAGES.NOTIFY_APPROVED : MESSAGES.NOTIFY_REJECTED;
            let linkMarkup = null;
            if (channelPostId) {
                const postUrl = await channelService.getPostUrl(channelPostId);
                if (postUrl) linkMarkup = keyboards.publishedNotice(postUrl);
            }
            await this.notifyAuthor(ctx, confession.authorId, notification, linkMarkup);

            // Update the review message in the admin chat (buttons disappear)
            try {
                await ctx.editMessageText(resultText);
            } catch (error) {
                logger.warn(`Could not edit review message: ${error.message}`);
            }

            await this._answer(ctx, approve ? '✅ Approved' : '❌ Rejected');
        } catch (error) {
            logger.error('Error in handleDecision:', error);
            await this._answer(ctx, MESSAGES.ADMIN.ERROR);
        }
    }

    // Publish an approved confession to the channel.
    // Returns { text, messageId } - text for the admin review message,
    // messageId so the author can be linked to the post (null if it failed).
    async publishToChannel(ctx, confessionId, confession) {
        try {
            channelService.setBot(ctx.telegram);
            const botInfo = await ctx.telegram.getMe();
            const post = await channelService.postToChannel(confession, botInfo.username);

            if (!post.success) {
                return {
                    messageId: null,
                    text: MESSAGES.ADMIN.REVIEW_DONE_APPROVED_NO_CHANNEL
                        .replace('{error}', post.error)
                        .replace('{id}', confessionId)
                };
            }

            await databaseService.updateChannelPostInfo(confessionId, post.messageId, post.date);
            return { messageId: post.messageId, text: MESSAGES.ADMIN.REVIEW_DONE_APPROVED };
        } catch (error) {
            logger.error('Error publishing to channel:', error);
            return {
                messageId: null,
                text: MESSAGES.ADMIN.REVIEW_DONE_APPROVED_NO_CHANNEL
                    .replace('{error}', error.message)
                    .replace('{id}', confessionId)
            };
        }
    }

    // Private notification to the author. Never throws - a user who never
    // pressed /start simply cannot be reached. markup is optional.
    async notifyAuthor(ctx, authorId, text, markup = null) {
        if (!authorId) {
            logger.warn(MESSAGES.NOTIFY_FAILED);
            return false;
        }
        try {
            await ctx.telegram.sendMessage(authorId, text, markup ? { reply_markup: markup } : undefined);
            return true;
        } catch (error) {
            logger.warn(`Could not notify author ${authorId}: ${error.message}`);
            return false;
        }
    }

    _answer(ctx, text) {
        if (!ctx.callbackQuery) return Promise.resolve();
        return ctx.answerCbQuery(text).catch(() => {});
    }

    /* ── admin commands ───────────────────────────────────────── */

    // /pending - list pending confessions with approve/reject buttons
    async viewPending(ctx) {
        try {
            const result = await databaseService.getPendingConfessions(10);

            if (!result.success) {
                await ctx.reply('❌ Failed to fetch pending confessions.');
                return;
            }
            if (result.count === 0) {
                await ctx.reply(MESSAGES.ADMIN.NO_PENDING);
                return;
            }

            for (const confession of result.confessions) {
                const topic = (TOPICS[confession.topic] || TOPICS.other).label;
                const preview = confession.text.length > 300
                    ? confession.text.substring(0, 300) + '…'
                    : confession.text;
                const message = MESSAGES.ADMIN.REVIEW_HEADER
                    .replace('{id}', String(confession._id))
                    .replace('{topic}', topic)
                    .replace('{date}', new Date(confession.createdAt).toLocaleString())
                    .replace('{text}', escapeHtml(preview));

                await ctx.reply(message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboards.adminReview(String(confession._id))
                });
            }
        } catch (error) {
            logger.error('Error in viewPending:', error);
            await ctx.reply('❌ Error fetching pending confessions.');
        }
    }

    // /post <id> - retry publishing an approved confession
    async postCommand(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2 || !ID_RE.test(args[1])) {
                await ctx.reply('Usage: /post <confession_id>');
                return;
            }
            const confessionId = args[1];

            const result = await databaseService.getConfessionById(confessionId);
            if (!result.success) {
                await ctx.reply(MESSAGES.ADMIN.NOT_FOUND);
                return;
            }
            if (result.confession.status !== STATUS.APPROVED) {
                await ctx.reply('⚠️ Only approved confessions can be posted. Approve it first.');
                return;
            }

            if (result.confession.channelPostId) {
                await ctx.reply(
                    `ℹ️ Already posted to the channel (message ${result.confession.channelPostId}).`
                );
                return;
            }

            const published = await this.publishToChannel(ctx, confessionId, result.confession);
            await ctx.reply(published.text);
        } catch (error) {
            logger.error('Error in postCommand:', error);
            await ctx.reply('❌ Error posting to channel');
        }
    }

    // /stats
    async getStats(ctx) {
        try {
            const stats = await databaseService.getStats();
            if (!stats.success) {
                await ctx.reply('❌ Failed to get statistics');
                return;
            }

            const message = `📊 <b>Bot Statistics</b>

🗂️ Total: <b>${stats.stats.total}</b>
📥 Pending: ${stats.stats.pending}
✅ Approved: ${stats.stats.approved}
❌ Rejected: ${stats.stats.rejected}

<i>Open the full panel with /admin</i>`;
            await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboards.adminStats() });
        } catch (error) {
            logger.error('Error in getStats:', error);
            await ctx.reply('❌ Error getting statistics');
        }
    }

    // /setchannel <@channel or id>
    async setChannel(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply(
                    'Usage: /setchannel @channel_username\n' +
                    'Or: /setchannel -1001234567890'
                );
                return;
            }

            const channelId = args[1];
            channelService.setChannelId(channelId);
            channelService.setBot(ctx.telegram);

            const verification = await channelService.verifyChannelAccess();

            if (!verification.success) {
                await ctx.reply(
                    `❌ Failed to access channel: ${verification.error}\n\n` +
                    'Make sure the channel ID is correct and the bot is an admin of the channel.'
                );
                return;
            }

            if (!verification.canPost) {
                await ctx.reply(
                    `⚠️ Bot can see "${verification.chatTitle}" but cannot post.\n` +
                    'Make the bot an admin with "Post Messages" permission.'
                );
                return;
            }

            await ctx.reply(
                `✅ Channel configured!\n\n` +
                `Channel: ${verification.chatTitle}\n` +
                `Status: ${verification.memberStatus} with posting permission`
            );
        } catch (error) {
            logger.error('Error in setChannel:', error);
            await ctx.reply('❌ Error setting channel');
        }
    }

    // /adminhelp
    async adminHelp(ctx) {
        const helpMessage = [
            '👮 <b>Admin Commands</b>',
            '',
            '/admin - Open the admin panel (pending, approved, rejected, stats, users, management)',
            '/pending - Review pending confessions',
            '/stats - Quick statistics',
            '/setchannel &lt;@channel&gt; - Set the publishing channel',
            '/post &lt;id&gt; - Retry publishing an approved confession',
            '/adminhelp - This help',
            '',
            '<i>Decisions always ask for confirmation first. Only configured admin IDs can use these.</i>'
        ].join(String.fromCharCode(10));

        await ctx.reply(helpMessage, { parse_mode: 'HTML' });
    }
}

module.exports = new AdminController();

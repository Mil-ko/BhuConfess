// src/controllers/admin.controller.js
// Admin review: send confessions for review, approve/reject with buttons,
// notify the author, publish approved confessions to the channel.
const { MESSAGES, STATUS, TOPICS } = require('../utils/constants');
const keyboards = require('../utils/keyboards');
const logger = require('../utils/logger');
const databaseService = require('../services/database.service');
const channelService = require('../services/channel.services.js');
const authMiddleware = require('../middleware/auth.middleware');

const ID_RE = /^[0-9a-f]{24}$/i;

class AdminController {
    /* ── review flow ──────────────────────────────────────────── */

    // Send a new confession to EVERY configured admin for review.
    async sendForReview(ctx, confession) {
        const topic = (TOPICS[confession.topic] || TOPICS.other).label;
        const text = MESSAGES.ADMIN.REVIEW_HEADER
            .replace('{id}', String(confession._id))
            .replace('{topic}', topic)
            .replace('{date}', new Date(confession.createdAt || Date.now()).toLocaleString())
            .replace('{text}', confession.text);

        for (const adminId of authMiddleware.adminIds) {
            try {
                await ctx.telegram.sendMessage(adminId, text, {
                    reply_markup: keyboards.adminReview(String(confession._id))
                });
            } catch (error) {
                logger.error(`Failed to send review to admin ${adminId}:`, error);
            }
        }
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
            if (approve) {
                resultText = await this.publishToChannel(ctx, confessionId, update.confession);
            } else {
                resultText = MESSAGES.ADMIN.REVIEW_DONE_REJECTED;
            }

            // Notify the AUTHOR (and only the author) of the decision.
            const notification = approve ? MESSAGES.NOTIFY_APPROVED : MESSAGES.NOTIFY_REJECTED;
            await this.notifyAuthor(ctx, confession.authorId, notification);

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
    // Returns the status text for the admin review message.
    async publishToChannel(ctx, confessionId, confession) {
        try {
            channelService.setBot(ctx.telegram);
            const botInfo = await ctx.telegram.getMe();
            const post = await channelService.postToChannel(confession, botInfo.username);

            if (!post.success) {
                return MESSAGES.ADMIN.REVIEW_DONE_APPROVED_NO_CHANNEL
                    .replace('{error}', post.error)
                    .replace('{id}', confessionId);
            }

            await databaseService.updateChannelPostInfo(confessionId, post.messageId, post.date);
            return MESSAGES.ADMIN.REVIEW_DONE_APPROVED;
        } catch (error) {
            logger.error('Error publishing to channel:', error);
            return MESSAGES.ADMIN.REVIEW_DONE_APPROVED_NO_CHANNEL
                .replace('{error}', error.message)
                .replace('{id}', confessionId);
        }
    }

    // Private notification to the author. Never throws - a user who never
    // pressed /start simply cannot be reached.
    async notifyAuthor(ctx, authorId, text) {
        if (!authorId) {
            logger.warn(MESSAGES.NOTIFY_FAILED);
            return false;
        }
        try {
            await ctx.telegram.sendMessage(authorId, text);
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
                    .replace('{text}', preview);

                await ctx.reply(message, {
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

            const text = await this.publishToChannel(ctx, confessionId, result.confession);
            await ctx.reply(text);
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

            const message = `📊 Admin Statistics

📝 Total Confessions: ${stats.stats.total}
⏳ Pending Review: ${stats.stats.pending}
✅ Approved: ${stats.stats.approved}
❌ Rejected: ${stats.stats.rejected}

Commands: /pending, /stats, /setchannel, /post, /adminhelp`;
            await ctx.reply(message);
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
        const helpMessage = `👮 Admin Commands

/pending - Review pending confessions (Approve / Reject buttons)
/stats - Show statistics
/setchannel <@channel> - Set the publishing channel
/post <id> - Retry publishing an approved confession
/adminhelp - This help

Approve and reject also work directly from the buttons on each review message.
Only configured admin IDs can use these.`;
        await ctx.reply(helpMessage);
    }
}

module.exports = new AdminController();

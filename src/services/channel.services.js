// src/services/channel.service.js
const logger = require('../utils/logger');
const { CHANNEL_POST_TEMPLATE, TOPICS } = require('../utils/constants');
const keyboards = require('../utils/keyboards');

class ChannelService {
    constructor() {
        this.bot = null;
        this.channelId = process.env.CHANNEL_ID;
        // Public @username of the channel, needed to build
        // https://t.me/<username>/<message_id> links. undefined = not looked
        // up yet, null = looked up and the channel has no public username.
        this.channelUsername = undefined;
    }

    // Set bot instance
    setBot(telegramApi) {
        // `telegramApi` is the Telegram API client (ctx.telegram): it has
        // sendMessage / getChat / getMe directly.
        this.bot = telegramApi;
    }

    // Update channel ID
    setChannelId(channelId) {
        this.channelId = channelId;
        this.channelUsername = undefined; // different channel → re-resolve
        logger.info(`Channel ID updated to: ${channelId}`);
        return true;
    }

    // Post confession to channel
    async postToChannel(confession, botUsername) {
        this.botUsername = botUsername;
        try {
            if (!this.bot) {
                throw new Error('Bot not initialized');
            }

            if (!this.channelId) {
                throw new Error('Channel ID not configured');
            }

            // Format the message
            const message = this.formatConfession(confession, botUsername);

            // Post to channel
            const result = await this.bot.sendMessage(
                this.channelId,
                message,
                {
                    // Plain text: the v1 template has no Markdown styling and
                    // user text must never go through an entity parser.
                    disable_web_page_preview: true,
                    reply_markup: keyboards.channelPost(confession._id, botUsername)
                }
            );

            // sendMessage returns the chat, so the link username is free here
            if (result.chat && result.chat.username) {
                this.channelUsername = result.chat.username;
            }

            logger.info(`✅ Confession ${confession._id} posted to channel. Message ID: ${result.message_id}`);

            return {
                success: true,
                messageId: result.message_id,
                date: new Date()
            };

        } catch (error) {
            logger.error('Error posting to channel:', error);
            
            // Handle specific errors
            if (error.description?.includes('chat not found')) {
                return {
                    success: false,
                    error: 'Channel not found. Make sure the channel ID is correct.'
                };
            }
            
            if (error.description?.includes('forbidden')) {
                return {
                    success: false,
                    error: 'Bot is not an admin in the channel. Please add the bot as admin.'
                };
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    // Public link to an already-published channel post.
    // Returns null when the channel has no public @username (private channels
    // have no t.me/<name>/<id> URL), so the caller can skip the button instead
    // of showing a dead link.
    async getPostUrl(messageId) {
        if (!this.bot || !this.channelId || !messageId) {
            return null;
        }
        try {
            if (this.channelUsername === undefined) {
                const chat = await this.bot.getChat(this.channelId);
                this.channelUsername = chat.username || null;
            }
            if (!this.channelUsername) {
                logger.warn('Channel has no public username - skipping post link');
                return null;
            }
            return `https://t.me/${this.channelUsername}/${messageId}`;
        } catch (error) {
            logger.warn(`Could not build channel post link: ${error.message}`);
            return null;
        }
    }

    // Refresh the comment count shown beside the Browse Comments button on
    // an already-published channel post. Never throws (deleted posts etc.).
    async updateCommentCount(confessionId, channelPostId, count) {
        if (!this.bot || !this.channelId || !channelPostId) {
            return false;
        }
        try {
            if (!this.botUsername) {
                const me = await this.bot.getMe();
                this.botUsername = me.username;
            }
            const markup = keyboards.channelPost(confessionId, this.botUsername, count);
            await this.bot.editMessageReplyMarkup(
                this.channelId,
                Number(channelPostId),
                undefined,
                markup
            );
            logger.info(`🔢 Comment count on channel post ${channelPostId} → ${count}`);
            return true;
        } catch (error) {
            // Channel post deleted or bot lost access - not fatal
            logger.warn(`Could not update comment count: ${error.message}`);
            return false;
        }
    }

    // Format confession for channel (plain text - no parse_mode)
    formatConfession(confession, botUsername) {
        const topicLabel = TOPICS[confession.topic]
            ? TOPICS[confession.topic].label
            : '💬 Other';

        // Public header: nickname when we have one, otherwise anonymous
        const header = confession.nickname
            ? `💭 Confession from ${confession.nickname}`
            : '💭 Anonymous Confession';

        // Replace template variables
        return CHANNEL_POST_TEMPLATE
            .replace('{header}', header)
            .replace('{topic}', topicLabel)
            .replace('{text}', confession.text)
            .replace('{bot_username}', botUsername.replace('@', ''));
    }

    // Preview how confession will look
    async previewConfession(ctx, confession) {
        try {
            const botInfo = await ctx.telegram.getMe();
            const preview = this.formatConfession(confession, botInfo.username);
            
            await ctx.replyWithMarkdown(
                `📝 *Channel Post Preview*\n\n${preview}\n\n---\n_This is how it will look in the channel_`,
                { disable_web_page_preview: true }
            );

        } catch (error) {
            logger.error('Error creating preview:', error);
            await ctx.reply('❌ Failed to create preview');
        }
    }

    // Verify bot is admin in channel
    async verifyChannelAccess() {
        try {
            if (!this.bot || !this.channelId) {
                return false;
            }

            // Try to get chat info
            const chat = await this.bot.getChat(this.channelId);
            
            // Try to get bot's permissions
            const botMember = await this.bot.getChatMember(
                this.channelId, 
                (await this.bot.getMe()).id
            );

            const canPost = botMember.status === 'administrator' || 
                           botMember.status === 'creator';

            logger.info(`Channel access check: ${canPost ? '✅' : '❌'}`);
            
            return {
                success: true,
                canPost,
                chatTitle: chat.title,
                chatUsername: chat.username,
                memberStatus: botMember.status
            };

        } catch (error) {
            logger.error('Channel access verification failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new ChannelService();
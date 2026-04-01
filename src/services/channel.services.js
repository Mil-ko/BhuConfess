// src/services/channel.service.js
const logger = require('../utils/logger');
const { CHANNEL_POST_TEMPLATE } = require('../utils/constants');

class ChannelService {
    constructor() {
        this.bot = null;
        this.channelId = process.env.CHANNEL_ID;
    }

    // Set bot instance
    setBot(bot) {
        this.bot = bot;
    }

    // Update channel ID
    setChannelId(channelId) {
        this.channelId = channelId;
        logger.info(`Channel ID updated to: ${channelId}`);
        return true;
    }

    // Post confession to channel
    async postToChannel(confession, botUsername) {
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
            const result = await this.bot.telegram.sendMessage(
                this.channelId,
                message,
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                }
            );

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

    // Format confession for channel
    formatConfession(confession, botUsername) {
        // Clean the text (remove any markdown that could break formatting)
        const cleanText = confession.text
            .replace(/_/g, '\\_')
            .replace(/\*/g, '\\*')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/~/g, '\\~')
            .replace(/`/g, '\\`')
            .replace(/>/g, '\\>')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Generate a short ID for the confession (last 6 chars of ObjectId)
        const shortId = confession._id.toString().slice(-6);

        // Replace template variables
        return CHANNEL_POST_TEMPLATE
            .replace('{text}', cleanText)
            .replace('{bot_username}', botUsername.replace('@', ''))
            .replace('{id}', shortId);
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
            const chat = await this.bot.telegram.getChat(this.channelId);
            
            // Try to get bot's permissions
            const botMember = await this.bot.telegram.getChatMember(
                this.channelId, 
                (await this.bot.telegram.getMe()).id
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
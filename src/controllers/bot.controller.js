// src/controllers/bot.controller.js
const { MESSAGES } = require('../utils/constants');
const validator = require('../utils/validator');
const logger = require('../utils/logger');
const databaseService = require('../services/database.service');

class BotController {
    // Handle /start command
    async handleStart(ctx) {
        try {
            logger.info(`User started bot: ${ctx.from.id}`);
            await ctx.replyWithMarkdown(MESSAGES.WELCOME);
        } catch (error) {
            logger.error('Error in handleStart:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle /help command
    async handleHelp(ctx) {
        try {
            await ctx.replyWithMarkdown(MESSAGES.HELP);
        } catch (error) {
            logger.error('Error in handleHelp:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle /privacy command
    async handlePrivacy(ctx) {
        try {
            await ctx.replyWithMarkdown(MESSAGES.PRIVACY);
        } catch (error) {
            logger.error('Error in handlePrivacy:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle /about command
    async handleAbout(ctx) {
        try {
            await ctx.replyWithMarkdown(MESSAGES.ABOUT);
        } catch (error) {
            logger.error('Error in handleAbout:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle /status command - now with database
    async handleStatus(ctx) {
        try {
            // Check if user has any pending confession in session
            if (!ctx.session || !ctx.session.lastConfessionId) {
                await ctx.replyWithMarkdown(`
📊 *No Confession Found*

You haven't submitted any confessions yet, or your confession ID is not available.

*How to check status:*
1. Submit a confession first
2. Keep the confirmation message with your confession ID
3. Use /status [confession_id] to check specific confession

Example: \`/status 507f1f77bcf86cd799439011\`
                `);
                return;
            }

            // Get status from database
            const result = await databaseService.getConfessionStatus(ctx.session.lastConfessionId);
            
            if (!result.success) {
                await ctx.reply(`❌ ${result.error}`);
                return;
            }

            const statusEmoji = {
                pending: '⏳',
                approved: '✅',
                rejected: '❌'
            };

            const statusMessage = `
${statusEmoji[result.status]} *Confession Status*

📝 Status: ${result.status.toUpperCase()}
📅 Submitted: ${new Date(result.submittedAt).toLocaleString()}
📏 Length: ${result.length} characters

${result.status === 'pending' ? 'Your confession is waiting for admin review.' : ''}
${result.status === 'approved' ? 'Your confession has been approved and may be posted to the channel.' : ''}
${result.status === 'rejected' ? 'Your confession was not approved for posting.' : ''}
            `;

            await ctx.replyWithMarkdown(statusMessage);

        } catch (error) {
            logger.error('Error in handleStatus:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle text messages (confessions) - now saving to database
    async handleMessage(ctx) {
        try {
            const confessionText = ctx.message.text;
            
            // Log incoming message (without user ID for privacy)
            logger.info(`Received message from user ${ctx.from.id}, length: ${confessionText.length}`);

            // Validate and sanitize confession
            const validation = validator.validateConfession(confessionText);
            
            if (!validation.isValid) {
                logger.debug(`Validation failed: ${validation.error}`);
                await ctx.reply(`❌ ${validation.error}`);
                return;
            }

            // Sanitize for database
            const sanitizedText = validator.sanitizeForDb(validation.cleaned);

            // Save to database
            const saveResult = await databaseService.saveConfession({
                text: sanitizedText,
                metadata: {
                    hasLinks: validation.hasLinks,
                    messageLength: validation.length
                }
            });

            if (!saveResult.success) {
                logger.error('Failed to save confession:', saveResult.error);
                await ctx.reply('❌ Failed to save your confession. Please try again later.');
                return;
            }

            // Store confession ID in session for status checking
            ctx.session = ctx.session || {};
            ctx.session.lastConfessionId = saveResult.id;

            logger.info('✅ Confession saved to database', { 
                id: saveResult.id,
                length: validation.length 
            });

            // Send confirmation with ID
            let response = `${MESSAGES.CONFESSION_RECEIVED}\n\n📋 *Your Confession ID:* \`${saveResult.id}\`\n\nUse this ID with /status to check your confession status.`;
            
            if (validation.hasLinks) {
                response += '\n\n⚠️ *Note:* Your confession contains links. It may take longer to review.';
            }

            await ctx.replyWithMarkdown(response);

        } catch (error) {
            logger.error('Error in handleMessage:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle /stats command (admin only - we'll add later)
    async handleStats(ctx) {
        try {
            const stats = await databaseService.getStats();
            
            if (!stats.success) {
                await ctx.reply('❌ Failed to get stats');
                return;
            }

            const statsMessage = `
📊 *Database Statistics*

Total Confessions: ${stats.stats.total}
⏳ Pending: ${stats.stats.pending}
✅ Approved: ${stats.stats.approved}
❌ Rejected: ${stats.stats.rejected}

Last updated: ${new Date().toLocaleString()}
            `;

            await ctx.replyWithMarkdown(statsMessage);

        } catch (error) {
            logger.error('Error in handleStats:', error);
            await ctx.reply(MESSAGES.ERROR);
        }
    }

    // Handle errors
    async handleError(ctx, error) {
        logger.error('Bot error:', error);
        
        // Don't expose internal errors to users
        const errorMessage = process.env.NODE_ENV === 'production' 
            ? MESSAGES.ERROR 
            : `❌ Error: ${error.message}`;
            
        await ctx.reply(errorMessage);
    }
}

module.exports = new BotController();
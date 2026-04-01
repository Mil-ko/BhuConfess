// src/controllers/admin.controller.js
const databaseService = require('../services/database.service');
const channelService = require('../services/channel.services.js');
const logger = require('../utils/logger');
const { STATUS, MESSAGES } = require('../utils/constants');

class AdminController {
    
    // View pending confessions
    async viewPending(ctx) {
        try {
            const result = await databaseService.getPendingConfessions(10);
            
            if (!result.success) {
                await ctx.reply('❌ Failed to fetch pending confessions.');
                return;
            }
 
            
            if (result.count === 0) {
                await ctx.reply('✅ No pending confessions to review.');
                return;
            }

            await ctx.reply(`📋 Found *${result.count}* pending confession(s):`, {
                parse_mode: 'Markdown'
            });

            // Send each confession separately
            for (const confession of result.confessions) {
                const message = this.formatConfessionForAdmin(confession);
                await ctx.replyWithMarkdown(message, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Approve', callback_data: `approve_${confession._id}` },
                                { text: '❌ Reject', callback_data: `reject_${confession._id}` }
                            ],
                            [
                                { text: '📄 View Full', callback_data: `view_${confession._id}` }
                            ]
                        ]
                    }
                });
            }

        } catch (error) {
            logger.error('Error in viewPending:', error);
            await ctx.reply('❌ Error fetching pending confessions.');
        }
    }

    // Handle callback queries (button presses)
    async handleCallback(ctx) {
        try {
            const callbackData = ctx.callbackQuery.data;
            const [action, confessionId] = callbackData.split('_');

            logger.info(`Admin callback: ${action} for confession ${confessionId}`);

            switch (action) {
                case 'approve':
                    await this.approveConfession(ctx, confessionId);
                    break;
                case 'reject':
                    await this.rejectConfession(ctx, confessionId);
                    break;
                case 'view':
                    await this.viewFullConfession(ctx, confessionId);
                    break;
                case 'post':
                    await this.postToChannel(ctx, confessionId);
                    break;
                default:
                    await ctx.answerCbQuery('Unknown action');
            }

        } catch (error) {
            logger.error('Error in handleCallback:', error);
            await ctx.answerCbQuery('Error processing request');
        }
    }

    // Approve confession
    async approveConfession(ctx, confessionId) {
        try {
            const adminId = ctx.from.id.toString();
            
            // First, get the confession to confirm it exists
            const confessionResult = await databaseService.getConfessionById(confessionId);
            
            if (!confessionResult.success) {
                await ctx.answerCbQuery('❌ Confession not found');
                return;
            }

            // Update status to approved
            const updateResult = await databaseService.updateConfessionStatus(
                confessionId,
                STATUS.APPROVED,
                adminId,
                'Approved by admin'
            );

            if (!updateResult.success) {
                await ctx.answerCbQuery('❌ Failed to approve confession');
                return;
            }

            // Answer callback query
            await ctx.answerCbQuery('✅ Confession approved!');

            // Update the message to show it's approved
            await ctx.editMessageReplyMarkup({
                inline_keyboard: [
                    [
                        { text: '✅ Approved', callback_data: 'disabled' },
                        { text: '📤 Post to Channel', callback_data: `post_${confessionId}` }
                    ]
                ]
            });

            // Notify about next steps
            await ctx.replyWithMarkdown(
                `✅ Confession approved!\n\nUse /post ${confessionId} to post it to the channel.`
            );

        } catch (error) {
            logger.error('Error in approveConfession:', error);
            await ctx.answerCbQuery('❌ Error approving confession');
        }
    }

    // Reject confession
    async rejectConfession(ctx, confessionId) {
        try {
            const adminId = ctx.from.id.toString();

            // Ask for rejection reason
            await ctx.answerCbQuery();
            
            // Store the confession ID in session for the reply
            ctx.session = ctx.session || {};
            ctx.session.pendingRejection = confessionId;
            
            await ctx.replyWithMarkdown(
                `Please provide a reason for rejection (or type "skip" to reject without reason):`,
                {
                    reply_markup: {
                        force_reply: true
                    }
                }
            );

        } catch (error) {
            logger.error('Error in rejectConfession:', error);
            await ctx.answerCbQuery('❌ Error rejecting confession');
        }
    }

    // Handle rejection reason
    async handleRejectionReason(ctx) {
        try {
            if (!ctx.session || !ctx.session.pendingRejection) {
                return false; // Not in rejection flow
            }

            const confessionId = ctx.session.pendingRejection;
            const reason = ctx.message.text;
            const adminId = ctx.from.id.toString();

            // Clear session
            delete ctx.session.pendingRejection;

            // Update status to rejected with reason
            const finalReason = reason.toLowerCase() === 'skip' ? null : reason;
            
            const updateResult = await databaseService.updateConfessionStatus(
                confessionId,
                STATUS.REJECTED,
                adminId,
                finalReason
            );

            if (!updateResult.success) {
                await ctx.reply('❌ Failed to reject confession');
                return true;
            }

            // Confirm rejection
            await ctx.replyWithMarkdown(
                finalReason 
                    ? `❌ Confession rejected.\nReason: ${finalReason}`
                    : '❌ Confession rejected without reason.'
            );

            return true;

        } catch (error) {
            logger.error('Error in handleRejectionReason:', error);
            await ctx.reply('❌ Error processing rejection');
            return true;
        }
    }

    // View full confession
    async viewFullConfession(ctx, confessionId) {
        try {
            const result = await databaseService.getConfessionById(confessionId);
            
            if (!result.success) {
                await ctx.answerCbQuery('❌ Confession not found');
                return;
            }

            await ctx.answerCbQuery();
            
            const confession = result.confession;
            const message = this.formatConfessionForAdmin(confession, true);
            
            await ctx.replyWithMarkdown(message);

        } catch (error) {
            logger.error('Error in viewFullConfession:', error);
            await ctx.answerCbQuery('❌ Error viewing confession');
        }
    }

    // List all confessions with filters
    async listConfessions(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            const filter = args[1] || 'pending'; // pending, approved, rejected, all
            const page = parseInt(args[2]) || 1;
            const limit = 5;

            let result;
            switch (filter) {
                case 'pending':
                    result = await databaseService.getPendingConfessions(limit);
                    break;
                case 'approved':
                    result = await databaseService.getApprovedConfessions(limit);
                    break;
                case 'rejected':
                    result = await databaseService.getRejectedConfessions(limit);
                    break;
                case 'posted':
                    result = await databaseService.getPostedConfessions(limit);
                    break;
                default:
                    result = await databaseService.getAllConfessions(limit, page);
            }

            if (!result.success || result.count === 0) {
                await ctx.reply(`No ${filter} confessions found.`);
                return;
            }

            await ctx.replyWithMarkdown(
                `Found *${result.count}* ${filter} confession(s) (Page ${page}):`
            );

            for (const confession of result.confessions) {
                const message = this.formatConfessionForAdmin(confession);
                await ctx.replyWithMarkdown(message);
            }

        } catch (error) {
            logger.error('Error in listConfessions:', error);
            await ctx.reply('❌ Error listing confessions');
        }
    }

    // Get statistics
    async getStats(ctx) {
        try {
            const stats = await databaseService.getStats();
            const posted = await databaseService.getPostedConfessions(1);
            
            if (!stats.success) {
                await ctx.reply('❌ Failed to get statistics');
                return;
            }

            const message = `
📊 *Admin Statistics*

*Overview:*
📝 Total Confessions: ${stats.stats.total}
⏳ Pending Review: ${stats.stats.pending}
✅ Approved: ${stats.stats.approved}
❌ Rejected: ${stats.stats.rejected}
📢 Posted to Channel: ${posted.count || 0}

*Actions:*
• /pending - Review pending confessions
• /list [filter] - List confessions (pending/approved/rejected/all/posted)
• /stats - Show this statistics
• /adminhelp - Show all admin commands

Last updated: ${new Date().toLocaleString()}
            `;

            await ctx.replyWithMarkdown(message);

        } catch (error) {
            logger.error('Error in getStats:', error);
            await ctx.reply('❌ Error getting statistics');
        }
    }

    // Set channel ID
    async setChannel(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            
            if (args.length < 2) {
                await ctx.replyWithMarkdown(
                    'Please provide a channel username or ID.\n\n' +
                    'Usage: `/setchannel @channel_username`\n' +
                    'Or: `/setchannel -1001234567890`'
                );
                return;
            }

            const channelId = args[1];
            
            // Set channel in service
            channelService.setChannelId(channelId);
            channelService.setBot(ctx.telegram);
            
            // Verify access
            const verification = await channelService.verifyChannelAccess();
            
            if (!verification.success) {
                await ctx.reply(
                    `❌ Failed to access channel: ${verification.error}\n\n` +
                    'Make sure:\n' +
                    '1. The channel username/ID is correct\n' +
                    '2. The bot is added as an admin to the channel\n' +
                    '3. The bot has permission to post'
                );
                return;
            }

            if (!verification.canPost) {
                await ctx.reply(
                    `⚠️ Bot can access channel "${verification.chatTitle}" but doesn't have posting permissions.\n\n` +
                    'Please make the bot an admin with "Post Messages" permission.'
                );
                return;
            }

            // Success!
            await ctx.replyWithMarkdown(
                `✅ *Channel configured successfully!*\n\n` +
                `Channel: ${verification.chatTitle}\n` +
                `Username: @${verification.chatUsername}\n` +
                `Status: Bot is ${verification.memberStatus} with posting permissions`
            );

        } catch (error) {
            logger.error('Error in setChannel:', error);
            await ctx.reply('❌ Error setting channel');
        }
    }

    // Post confession to channel
    async postToChannel(ctx, confessionId) {
        try {
            // If confessionId is not provided, get it from message
            if (!confessionId) {
                const args = ctx.message.text.split(' ');
                if (args.length < 2) {
                    await ctx.reply('Please provide a confession ID. Usage: /post [confession_id]');
                    return;
                }
                confessionId = args[1];
            }

            // Get confession
            const confessionResult = await databaseService.getConfessionById(confessionId);
            
            if (!confessionResult.success) {
                await ctx.reply('❌ Confession not found');
                return;
            }

            const confession = confessionResult.confession;

            // Check if already posted
            if (confession.channelPostId) {
                const confirm = await this.askConfirmation(
                    ctx,
                    '⚠️ This confession was already posted to the channel. Post again?'
                );
                
                if (!confirm) {
                    return;
                }
            }

            // Check if approved
            if (confession.status !== STATUS.APPROVED) {
                await ctx.reply('⚠️ Only approved confessions can be posted. Approve it first using /approve');
                return;
            }

            // Set bot in channel service
            channelService.setBot(ctx.telegram);

            // Verify channel access first
            const verification = await channelService.verifyChannelAccess();
            
            if (!verification.success || !verification.canPost) {
                await ctx.reply(
                    '❌ Cannot post to channel. Please check:\n' +
                    '1. Channel is configured (/setchannel)\n' +
                    '2. Bot is admin in channel\n' +
                    '3. Bot has posting permissions'
                );
                return;
            }

            // Get bot info for template
            const botInfo = await ctx.telegram.getMe();

            // Post to channel
            const postResult = await channelService.postToChannel(confession, botInfo.username);

            if (!postResult.success) {
                await ctx.reply(`❌ Failed to post: ${postResult.error}`);
                return;
            }

            // Update confession with channel post info
            await databaseService.updateChannelPostInfo(
                confessionId,
                postResult.messageId,
                postResult.date
            );

            await ctx.replyWithMarkdown(
                `✅ *Confession posted to channel!*\n\n` +
                `Message ID: \`${postResult.messageId}\`\n` +
                `Posted at: ${postResult.date.toLocaleString()}`
            );

        } catch (error) {
            logger.error('Error in postToChannel:', error);
            await ctx.reply('❌ Error posting to channel');
        }
    }

    // Preview confession in channel format
    async previewChannelPost(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            
            if (args.length < 2) {
                await ctx.reply('Please provide a confession ID. Usage: /preview [confession_id]');
                return;
            }

            const confessionId = args[1];

            // Get confession
            const confessionResult = await databaseService.getConfessionById(confessionId);
            
            if (!confessionResult.success) {
                await ctx.reply('❌ Confession not found');
                return;
            }

            // Get channel service for preview
            await channelService.previewConfession(ctx, confessionResult.confession);

        } catch (error) {
            logger.error('Error in previewChannelPost:', error);
            await ctx.reply('❌ Error creating preview');
        }
    }

    // Check channel status
    async channelStatus(ctx) {
        try {
            channelService.setBot(ctx.telegram);

            const status = await channelService.verifyChannelAccess();

            if (!status.success) {
                await ctx.reply(`❌ Channel error: ${status.error}`);
                return;
            }

            const statusMessage = `
📢 *Channel Status*

Channel: ${status.chatTitle}
Username: @${status.chatUsername}
Bot Status: ${status.memberStatus}
Can Post: ${status.canPost ? '✅ Yes' : '❌ No'}

${status.canPost ? 
  '✓ Bot is ready to post confessions!' : 
  '⚠️ Bot needs posting permissions. Add as admin with "Post Messages" permission.'}
            `;

            await ctx.replyWithMarkdown(statusMessage);

        } catch (error) {
            logger.error('Error in channelStatus:', error);
            await ctx.reply('❌ Error checking channel status');
        }
    }

    // Admin help
    async adminHelp(ctx) {
        const helpMessage = `
👮 *Admin Commands*

*Review Commands:*
/pending - View pending confessions with buttons
/list [filter] - List confessions (pending/approved/rejected/all/posted)
/stats - Show statistics

*Action Commands:*
/approve [id] - Approve a confession
/reject [id] [reason] - Reject a confession
/view [id] - View full confession

*Channel Commands:*
/setchannel [@channel] - Set default channel
/post [id] - Post approved confession to channel
/preview [id] - Preview how confession will look in channel
/channelstatus - Check channel configuration

*Note:* All admin commands are only available to authorized admins.
        `;

        await ctx.replyWithMarkdown(helpMessage);
    }

    // Handle confirmation replies
    async handleConfirmation(ctx) {
        if (!ctx.session || !ctx.session.waitingForConfirmation) {
            return false;
        }

        const { question, resolve } = ctx.session.waitingForConfirmation;
        const answer = ctx.message.text.toLowerCase();

        if (answer === 'yes' || answer === 'y') {
            await ctx.reply('✅ Confirmed');
            resolve(true);
        } else {
            await ctx.reply('❌ Cancelled');
            resolve(false);
        }

        delete ctx.session.waitingForConfirmation;
        return true;
    }

    // Helper to ask for confirmation
    async askConfirmation(ctx, question) {
        return new Promise((resolve) => {
            // Store in session that we're waiting for confirmation
            ctx.session = ctx.session || {};
            ctx.session.waitingForConfirmation = {
                question,
                resolve
            };

            ctx.reply(question + ' Reply with "yes" to confirm, or "no" to cancel.');
        });
    }

    // Format confession for admin view
    formatConfessionForAdmin(confession, fullView = false) {
        const date = new Date(confession.createdAt).toLocaleString();
        const statusEmoji = {
            pending: '⏳',
            approved: '✅',
            rejected: '❌'
        }[confession.status] || '📝';

        let message = `${statusEmoji} *Confession ID:* \`${confession._id}\`\n`;
        message += `📅 *Submitted:* ${date}\n`;
        
        if (fullView) {
            message += `📝 *Content:*\n${confession.text}\n\n`;
        } else {
            // Show preview
            const preview = confession.text.length > 200 
                ? confession.text.substring(0, 200) + '...' 
                : confession.text;
            message += `📝 *Preview:*\n${preview}\n\n`;
        }

        message += `📊 *Status:* ${confession.status.toUpperCase()}\n`;
        
        if (confession.metadata) {
            message += `🔗 *Has Links:* ${confession.metadata.hasLinks ? 'Yes' : 'No'}\n`;
            message += `📏 *Length:* ${confession.metadata.messageLength} chars\n`;
        }

        if (confession.channelPostId) {
            message += `📢 *Posted to Channel:* Yes\n`;
            message += `📎 *Message ID:* ${confession.channelPostId}\n`;
        }

        if (confession.adminAction && confession.adminAction.performedBy) {
            message += `👮 *Reviewed by:* ${confession.adminAction.performedBy}\n`;
            message += `🕐 *Reviewed at:* ${new Date(confession.adminAction.performedAt).toLocaleString()}\n`;
            
            if (confession.adminAction.reason) {
                message += `💬 *Reason:* ${confession.adminAction.reason}\n`;
            }
        }

        return message;
    }
}

module.exports = new AdminController();
// src/utils/constants.js
module.exports = {
    // Bot messages
    MESSAGES: {
        // Public messages
        WELCOME: `👋 Welcome to the Anonymous Confession Bot!

I'm here to listen to your secrets, confessions, and thoughts - completely anonymously.

📝 *How to use:*
• Just send me any message - it will be stored as your confession
• An admin will review all confessions
• If approved, your confession may be posted to our public channel

🔒 *Privacy:*
• Your identity remains completely anonymous
• No personal data is stored
• You don't need to register or sign up

Type /help to see all commands.`,

        HELP: `*Available Commands:*

/start - Start the bot and see welcome message
/help - Show this help message
/status - Check the status of your confession
/privacy - Learn about privacy and anonymity
/about - About this bot

*How to confess:*
Simply type your confession and send it to me. It's that easy!

Your confession will be reviewed by an admin and may be posted to our channel if approved.`,

        PRIVACY: `*Privacy & Anonymity*

🔐 *Complete Anonymity*
• We don't store your Telegram ID
• No usernames or personal info are saved
• Your messages are stored without any identifying information

📊 *Data Storage*
• Confessions are stored in a secure database
• Only the confession text and timestamp are saved
• No IP addresses, user IDs, or metadata

👮 *Review Process*
• An admin reviews all confessions
• This is to prevent spam and inappropriate content
• The admin cannot see who sent the confession

❓ Questions?
Contact @yourusername if you have concerns about privacy.`,

        ABOUT: `*About This Bot*

🤖 Version: 1.0.0
📅 Created: 2024
⚙️ Built with: Node.js, Telegraf, MongoDB

This bot allows you to share anonymous confessions that may be posted to our public channel.

Report issues or suggest features: @yourusername`,

        CONFESSION_RECEIVED: `✅ Your confession has been received!

It will be reviewed by an admin. If approved, it may be posted to our channel.

You will not receive a notification about the status (to maintain anonymity), but you can use /status to check.`,

        ERROR: `❌ Sorry, an error occurred. Please try again later.`,

        // Admin messages
        ADMIN: {
            WELCOME: '👮 Welcome to Admin Panel!\n\nUse /pending to review confessions.',
            NO_PENDING: '✅ No pending confessions to review.',
            APPROVED: '✅ Confession approved successfully!',
            REJECTED: '❌ Confession rejected.',
            ERROR: '❌ Error processing admin command.',
            INVALID_ID: '❌ Invalid confession ID.',
            NOT_FOUND: '❌ Confession not found.'
        },

        // Channel messages
        CHANNEL: {
            POSTED: '✅ Confession has been posted to the channel!',
            POST_FAILED: '❌ Failed to post to channel. Make sure the bot is an admin.',
            SET_CHANNEL: '📢 Channel has been set to {channel}',
            NO_CHANNEL: '⚠️ No channel configured. Use /setchannel to configure.',
            PREVIEW: '📝 *Preview of channel post:*\n\n{preview}',
            CONFIRM_POST: 'Ready to post? Click confirm to publish.',
            POSTED_INFO: 'Posted to channel on {date}'
        }
    },

    // Channel message template
    CHANNEL_POST_TEMPLATE: `💭 *Anonymous Confession*

{text}

---

*Want to confess?* Send a message to @{bot_username}
#{id}`,

    // Confession statuses
    STATUS: {
        PENDING: 'pending',
        APPROVED: 'approved',
        REJECTED: 'rejected'
    },

    // Bot commands list for reference
    COMMANDS: [
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'Show help information' },
        { command: 'status', description: 'Check your confession status' },
        { command: 'privacy', description: 'Learn about privacy' },
        { command: 'about', description: 'About this bot' },
        { command: 'setchannel', description: 'Set the channel for posting (admin)' },
        { command: 'post', description: 'Post a confession to channel (admin)' },
        { command: 'preview', description: 'Preview how confession will look in channel (admin)' },
        { command: 'pending', description: 'View pending confessions (admin)' },
        { command: 'stats', description: 'Show statistics (admin)' },
        { command: 'adminhelp', description: 'Show admin commands (admin)' }
    ]
};
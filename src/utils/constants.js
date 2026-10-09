// src/utils/constants.js
module.exports = {
    // Bot messages
    MESSAGES: {
        WELCOME: `👋 Welcome to the Anonymous Confession Bot!

Share what's on your mind — completely anonymously.

Use the menu below to get started:`,
        MENU: '🏠 Main Menu\n\nChoose an option:',
        HELP: `📖 Help

• Send Confession — choose a topic, write your confession, preview it, then submit it for review
• Profile — see how many confessions you've submitted and how many were approved
• /status — check the status of your last submitted confession
• /privacy — learn how your data is handled
• /about — about this bot

Once approved by an admin, your confession is published to our channel. Comments and replies happen right here in the bot.`,
        PRIVACY: `🔐 Privacy & Anonymity

• Confessions are published under the NICKNAME you choose — never your real name or username
• We store your Telegram ID only to send you the approve/reject decision and to count your submissions in your profile
• Admins never see who wrote a confession
• You can edit or cancel your confession before submitting it
• After submitting, it is locked while pending review
• Your nickname can be changed once every 14 days`,
        ABOUT: `🤖 Anonymous Confession Bot v1.0

Built with Node.js, Telegraf and MongoDB.
Confessions are reviewed by an admin before being published.`,
        ERROR: '❌ Sorry, an error occurred. Please try again later.',

        // Confession flow
        TOPIC_PROMPT: '🏷️ Choose a topic for your confession:',
        WRITE_PROMPT: '✏️ Now write your confession.\n\n• 3–4000 characters\n• You will see a preview before submitting',
        EDIT_PROMPT: '✏️ Send your new text. You will see a new preview before submitting.',
        PREVIEW_HEADER: '📝 Preview\n\nTopic: {topic}\n\n{text}',
        PREVIEW_ACTIONS: 'Is everything correct?',
        SUBMITTED: '✅ Your confession has been submitted!\n\n🆔 ID: {id}\n\nIt is now locked and waiting for admin review. You will be notified here when it is approved or rejected.',
        CANCELLED: '👌 Cancelled. Nothing was submitted.',
        LOCKED: '⚠️ You are not writing anything right now.\n\nTap a button below to continue:',
        INVALID_CONFESSION: '❌ {error}',
        DRAFT_EMPTY: '⚠️ Nothing to submit yet — write your confession first.',

        // Decision notifications (sent only to the author)
        NOTIFY_APPROVED: '🎉 Good news! Your confession was approved and has been published to our channel.',
        NOTIFY_REJECTED: '😔 Your confession was not approved for publication.\n\nYou can submit a new one any time from the main menu.',
        NOTIFY_FAILED: '⚠️ Could not deliver notification to the author (user has not started the bot).',

        // Comment/reply activity notifications (sent to the confession or
        // comment owner, never to whoever caused the event)
        NOTIFY_NEW_COMMENT: '💬 New comment on your confession:\n\n"{snippet}"',
        NOTIFY_NEW_REPLY: '↩️ New reply on your confession:\n\n"{snippet}"',
        NOTIFY_REPLY_YOUR_COMMENT: '↩️ {name} replied to your comment:\n\n"{snippet}"',

        // Comments
        COMMENTS_PROMPT: '💬 Write your comment.\n\n• 1–1000 characters\n• You will see a preview before submitting',
        COMMENT_PREVIEW: '💬 Preview\n\n{text}',
        COMMENT_SUBMITTED: '✅ Comment posted!',
        REPLY_PROMPT: '↩️ Replying to:\n\n"{excerpt}"\n\nWrite your reply (1–1000 characters):',
        REPLY_PREVIEW: '↩️ Reply Preview\n\n{text}',
        REPLY_SUBMITTED: '✅ Reply posted!',
        COMMENT_CANCELLED: '👌 Comment cancelled.',
        NO_COMMENTS: '💬 No comments yet. Be the first!',
        COMMENTS_HEADER: '💬 Comments for this confession — page {page}/{pages}\n\n{list}',
        COMMENT_NOT_FOUND: '❌ Comment not found.',
        CONFESSION_NOT_FOUND: '❌ Confession not found.',

        // Profile / stats
        PROFILE: '👤 Your Profile\n\nName: {name}\n{username}\n📛 Nickname: {nickname}\n\n📝 Confessions submitted: {submitted}\n✅ Approved: {approved}',

        // Nickname flow
        NICKNAME_ASK: '✏️ First things first — what nickname should we show with your confessions and comments?\n\n• 2–20 characters\n• You can change it later from your Profile (once every 14 days)',
        NICKNAME_CHANGE_PROMPT: '✏️ Send your new nickname.\n\n• 2–20 characters\n• You can change it again in 14 days',
        NICKNAME_SAVED: '✅ Your nickname is now: {nickname}',
        NICKNAME_INVALID: '❌ {error}',
        NICKNAME_COOLDOWN: '🔒 You changed your nickname recently. You can change it again on {date}.',

        // Admin messages
        ADMIN: {
            WELCOME: '👮 Admin Panel\n\nUse /pending to review confessions.',
            NO_PENDING: '✅ No pending confessions to review.',
            APPROVED: '✅ Confession approved.',
            REJECTED: '❌ Confession rejected.',
            ERROR: '❌ Error processing admin action.',
            INVALID_ID: '❌ Invalid confession ID.',
            NOT_FOUND: '❌ Confession not found.',
            ALREADY_HANDLED: '⚠️ This confession was already handled.',
            NOT_ADMIN: '⛔ Only admins can do that.',
            REVIEW_HEADER: '📨 New confession for review\n\n🆔 ID: {id}\n🏷️ Topic: {topic}\n📅 Submitted: {date}\n\n{text}',
            REVIEW_DONE_APPROVED: '✅ Approved and published to the channel.',
            REVIEW_DONE_APPROVED_NO_CHANNEL: '✅ Approved, but publishing to the channel failed: {error}\nUse /post {id} to retry.',
            REVIEW_DONE_REJECTED: '❌ Rejected. The author was notified.'
        },

        // Channel messages
        CHANNEL: {
            POSTED: '✅ Confession published to the channel.',
            POST_FAILED: '❌ Failed to post to channel: {error}',
            SET_CHANNEL: '📢 Channel set to {channel}',
            NO_CHANNEL: '⚠️ No channel configured. Use /setchannel to configure.',
            PREVIEW: '📝 Channel post preview:\n\n{preview}'
        }
    },

    // Nickname rules
    NICKNAME: {
        MIN: 2,
        MAX: 20,
        CHANGE_COOLDOWN_DAYS: 14
    },

    // Topics offered during the confession flow
    TOPICS: {
        love: { label: '❤️ Love' },
        friendship: { label: '🤝 Friendship' },
        family: { label: '👨‍👩‍👧 Family' },
        school: { label: '🎓 School/Work' },
        other: { label: '💬 Other' }
    },

    // Channel message template ({header} already includes the emoji)
    CHANNEL_POST_TEMPLATE: `{header}
🏷️ {topic}

{text}

---
Want to confess? Message @{bot_username}`,

    // Confession statuses
    STATUS: {
        PENDING: 'pending',
        APPROVED: 'approved',
        REJECTED: 'rejected'
    },

    // Bot commands list (registered with Telegram)
    COMMANDS: [
        { command: 'start', description: 'Open the main menu' },
        { command: 'help', description: 'Show help information' },
        { command: 'status', description: 'Check your last confession status' },
        { command: 'privacy', description: 'Privacy & anonymity' },
        { command: 'about', description: 'About this bot' }
    ],
    ADMIN_COMMANDS: [
        { command: 'pending', description: 'Review pending confessions' },
        { command: 'stats', description: 'Show statistics' },
        { command: 'setchannel', description: 'Set the publishing channel' },
        { command: 'adminhelp', description: 'Admin commands' }
    ]
};

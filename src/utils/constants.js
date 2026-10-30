// src/utils/constants.js
module.exports = {
    // Bot messages
    MESSAGES: {
        WELCOME: ` Welcome to BHU Anonymous Confessions! 🎉🤫💬✨

💭 Got something on your mind? Share your thoughts, secrets, or feelings anonymously.

👇 Use the menu below to get started!`,
        MENU: '🏠 <b>Main Menu</b>\n\nWhat would you like to do today?',
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
        ABOUT: `🤖 BHU Confession Bot

Your safe space to share thoughts, stories, secrets, and confessions anonymously.

💬 Share your confession.
🔒 Protect your identity.
🛡️ Every confession is reviewed by an admin before publication.`,
        ERROR: '❌ Sorry, an error occurred. Please try again later.',

        // Confession flow
        TOPIC_PROMPT: '🏷️ Choose a topic for your confession:',
        WRITE_PROMPT: '✏️ Now write your confession.\n\n• 3–4000 characters\n• You will see a preview before submitting',
        EDIT_PROMPT: '✏️ Send your new text. You will see a new preview before submitting.',
        PREVIEW_HEADER: '📝 <b>Preview</b>\n\n🏷️ {topic}\n\n<blockquote>{text}</blockquote>\n\n<i>Is everything correct?</i>',
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

        // Comments (discussion UI) - rendered with parse_mode HTML, so every
        // piece of user content must be escaped before it is interpolated.
        COMMENTS_PROMPT: '💬 Write your comment.\n\n• 1–1000 characters\n• You will see a preview before submitting',
        COMMENT_PREVIEW: '💬 <b>Your comment</b>\n\n<blockquote>{text}</blockquote>\n\n<i>Post it?</i>',
        COMMENT_SUBMITTED: '✅ Comment posted!',
        COMMENT_CANCELLED: '👌 Comment cancelled.',

        // Reply context: the comment being answered is shown BEFORE the user
        // types, so they always see exactly what they are replying to.
        REPLY_CONTEXT: '↩️ <b>Replying to {name}</b>\n\n<blockquote>{excerpt}</blockquote>\n\n<i>Write your reply below · 1–1000 characters</i>',
        REPLY_PREVIEW: '↩️ <b>Replying to {name}</b>\n\n<blockquote>{excerpt}</blockquote>\n\n<b>Your reply</b>\n<blockquote>{text}</blockquote>\n\n<i>Send it?</i>',
        REPLY_SUBMITTED: '✅ Reply posted!',

        // Discussion view
        DISCUSSION_HEADER: '💬 <b>Discussion</b>{page}\n<blockquote>{excerpt}</blockquote>\n📊 {count}',
        DISCUSSION_PAGE: ' · <i>page {page}/{pages}</i>',
        DISCUSSION_EMPTY: '💬 <b>No comments yet</b>\n\n<blockquote>{excerpt}</blockquote>\n\nBe the first to share what you think.',
        DISCUSSION_REPLIES_HIDDEN: '↳ <i>{count} · tap to open</i>',
        DISCUSSION_REPLIES_MORE: '↳ <i>+{count} earlier</i>',
        COMMENT_NOT_FOUND: '❌ Comment not found.',
        CONFESSION_NOT_FOUND: '❌ Confession not found.',

        // Profile / activity
        PROFILE: '👤 <b>Your Profile</b>\n\n📛 Nickname: <b>{nickname}</b>\n🆔 Telegram: {username}\n\n📝 Confessions: {submitted} · ✅ {approved} approved\n💬 Comments: {comments}\n\n<i>Your nickname — never your name or username — is what other readers see.</i>',
        ACTIVITY: '📊 <b>My Activity</b>\n\n📝 Confessions: <b>{submitted}</b>\n  ⏳ Pending: {pending} · ✅ Approved: {approved} · ❌ Rejected: {rejected}\n\n💬 Comments: <b>{comments}</b>\n  ↩️ Replies: {replies}\n❤️ Reactions received: <b>{reactions}</b>',

        // Personal lists
        MY_CONFESSIONS_HEADER: '📊 <b>My Confessions</b> · <i>page {page}/{pages}</i>\n\n📝 {total} submitted',
        MY_CONFESSIONS_EMPTY: '📊 <b>My Confessions</b>\n\nYou have not submitted a confession yet.\n\n<i>Tap below to write your first one.</i>',
        MY_CONFESSION_CARD: '{status} <i>{when}</i>{comments}\n<blockquote>{text}</blockquote>',
        MY_CONFESSION_COMMENTS: '\n💬 {count} in discussion',
        MY_COMMENTS_HEADER: '💬 <b>My Comments</b> · <i>page {page}/{pages}</i>\n\n💬 {total} written',
        MY_COMMENTS_EMPTY: '💬 <b>My Comments</b>\n\nYou have not commented on anything yet.\n\n<i>Browse the confessions and join a discussion.</i>',
        MY_COMMENT_CARD: '💬 <i>{when}</i>\n<blockquote>{text}</blockquote>\n📖 <i>{confession}</i>',

        // Confession feed
        FEED_HEADER: '📖 <b>Confessions</b> · <i>page {page}/{pages}</i>\n\n🗂️ {total} published · tap one to read the discussion',
        FEED_EMPTY: '📖 <b>Confessions</b>\n\nNothing has been published yet.\n\n<i>Be the first — send a confession and an admin will review it.</i>',
        FEED_CARD: '📖 <b>#{index}</b> · {topic} · <i>{when}</i>\n<blockquote>{text}</blockquote>\n💬 {comments}',

        // Contact the admins
        CONTACT_PROMPT: '📩 <b>Contact the Admins</b>\n\nSend your message in one message:\n• 10–1000 characters\n• Our admins read every message\n• Your Telegram name is not shared with anyone else',
        CONTACT_PREVIEW: '📩 <b>Your message</b>\n\n<blockquote>{text}</blockquote>\n\n<i>Send this to the admins?</i>',
        CONTACT_SENT: '✅ Message sent to the admins. Thank you!',
        CONTACT_FAILED: '⚠️ No admin could receive your message right now. Please try again later.',
        CONTACT_TO_ADMIN: '📩 <b>Message from a reader</b>\n\n<blockquote>{text}</blockquote>',

        // Status words used in personal lists
        STATUS_LABEL: {
            pending: '⏳ Pending review',
            approved: '✅ Approved',
            rejected: '❌ Rejected'
        },

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
            REVIEW_DONE_REJECTED: '❌ Rejected. The author was notified.',
            NOTIFY_CHANGES: '✏️ An admin asked for changes to your confession:\n\n"{note}"\n\nThe confession was not published. You can send a new version any time from the main menu.',

            // Admin panel screens
            HUB: '🛠️ <b>Admin Panel</b>\n\n📥 Pending: <b>{pending}</b>\n✅ Approved: {approved}\n❌ Rejected: {rejected}\n🗂️ Total: {total}',
            LIST_PENDING: '📥 <b>Pending confessions</b> · <i>page {page}/{pages}</i>\n\n👀 Preview before deciding. Nothing is published until you approve.',
            LIST_APPROVED: '✅ <b>Approved confessions</b> · <i>page {page}/{pages}</i>',
            LIST_REJECTED: '❌ <b>Rejected confessions</b> · <i>page {page}/{pages}</i>',
            EMPTY_PENDING: '🎉 <b>Nothing to review</b>\n\nEvery confession has been handled.',
            EMPTY_APPROVED: '📭 <b>No approved confessions yet</b>',
            EMPTY_REJECTED: '📭 <b>No rejected confessions yet</b>',
            PREVIEW: '👁️ <b>Confession preview</b>\n\n{status}\n🏷️ {topic}\n📅 {date}\n🆔 <code>{id}</code>\n\n<blockquote>{text}</blockquote>\n\n{comments}',
            CONFIRM_APPROVE: '✅ <b>Approve this confession?</b>\n\nIt will be published to the channel right away.\n\n<blockquote>{excerpt}</blockquote>',
            CONFIRM_REJECT: '❌ <b>Reject this confession?</b>\n\nThe author is notified and nothing is published.\n\n<blockquote>{excerpt}</blockquote>',
            CONFIRM_CHANGES: '✏️ <b>Request changes</b>\n\nSend one message with the note for the author (10–500 characters). It is delivered privately with your text.',
            CHANGES_PREVIEW: '✏️ <b>Note to the author</b>\n\n<blockquote>{note}</blockquote>\n\n<i>Send it and keep the confession unpublished?</i>',
            CHANGES_SENT: '✅ Note sent. The confession stays unpublished.',
            NO_EXCERPT: '<i>(no text)</i>',
            POSTED: '📢 Published to the channel.',
            POST_FAILED: '❌ Publishing failed: {error}',
            USER_STATS: '👥 <b>User Statistics</b>\n\n👤 Profiles: <b>{users}</b>\n📛 Nicknames set: {nicknames}\n📝 Confessions per author: {avg}\n💬 Comments written: {comments}\n❤️ Reactions given: {reactions}\n\n<b>Top confessors</b>\n{top}',
            NO_TOP: '<i>No confessions yet.</i>',
            MANAGE: '⚙️ <b>Bot Management</b>\n\n🤖 Bot: {bot}\n📢 Channel: {channel}\n🗄️ Database: {db}\n⏱️ Uptime: {uptime}\n🔁 Keep-alive: {keepalive}\n\n<i>Change the channel with</i> <code>/setchannel @name</code>'
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

    // Reaction buttons on each comment card. The key is stored in Mongo and
    // travels in callback data, so it must stay short and URL-safe.
    REACTION_EMOJI: {
        heart: '❤️',
        laugh: '😂',
        fire: '🔥',
        like: '👍'
    },

    // Discussion layout limits (Telegram caps a message at 4096 characters)
    COMMENT_UI: {
        PER_PAGE: 4,          // top-level comments per page
        MAX_REPLIES: 4,       // replies shown when a thread is expanded
        MAX_TEXT: 700,        // characters of the comment itself
        MAX_REPLY_TEXT: 320,  // characters per nested reply
        MAX_EXCERPT: 140      // confession excerpt in the header
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
        { command: 'menu', description: 'Show the menu buttons' },
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

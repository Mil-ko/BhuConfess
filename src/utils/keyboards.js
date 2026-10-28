// src/utils/keyboards.js
// Inline keyboard builders. Callback data format: <prefix>_<id>[_<page>]
// Prefixes: c_* confession flow, ad_* admin decisions, cb/cn_* comments, m_* menu.
const { TOPICS } = require('./constants');

const keyboards = {
    // Main menu
    mainMenu() {
        return {
            inline_keyboard: [
                [{ text: '✉️ Send Confession', callback_data: 'c_start' }],
                [{ text: '👤 Profile', callback_data: 'm_profile' }],
                [{ text: '📖 Help', callback_data: 'm_help' }]
            ]
        };
    },

    // Topic selection
    topics() {
        const rows = Object.entries(TOPICS).map(([key, t]) => ([{ text: t.label, callback_data: `c_topic_${key}` }]));
        rows.push([{ text: '🔙 Back', callback_data: 'm_menu' }]);
        return { inline_keyboard: rows };
    },

    // Confession preview actions
    confessionPreview() {
        return {
            inline_keyboard: [
                [
                    { text: '✏️ Edit', callback_data: 'c_edit' },
                    { text: '✅ Submit', callback_data: 'c_submit' },
                    { text: '✖️ Cancel', callback_data: 'c_cancel' }
                ]
            ]
        };
    },

    // Profile actions
    profile() {
        return {
            inline_keyboard: [
                [{ text: '✏️ Change nickname', callback_data: 'm_nick' }],
                [{ text: '🏠 Main Menu', callback_data: 'm_menu' }]
            ]
        };
    },

    // After cancelling / for the lock hint
    backToMenu() {
        return { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'm_menu' }]] };
    },

    // Admin review message
    adminReview(confessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Approve', callback_data: `ad_ok_${confessionId}` },
                    { text: '❌ Reject', callback_data: `ad_no_${confessionId}` }
                ]
            ]
        };
    },

    // Published channel post.
    // URL deep links (not callback_data): tapping one OPENS the bot chat and
    // auto-sends /start <payload>, so the user lands directly on the page
    // they wanted - even if they never started the bot before.
    // commentCount refreshes the number shown beside Browse Comments.
    channelPost(confessionId, botUsername, commentCount = 0) {
        const base = `https://t.me/${String(botUsername || '').replace('@', '')}?start=`;
        const browseLabel = commentCount > 0
            ? `💬 Browse Comments (${commentCount})`
            : '💬 Browse Comments';
        return {
            inline_keyboard: [
                [
                    { text: browseLabel, url: `${base}cb_${confessionId}_0` },
                    { text: '✏️ Send Comment', url: `${base}cn_new_${confessionId}` }
                ]
            ]
        };
    },

    // Approval notification sent privately to the author.
    // A plain URL button (no callback_data): it opens the post on the channel
    // so the author can find their confession without scrolling the feed.
    publishedNotice(channelUrl) {
        return {
            inline_keyboard: [
                [{ text: '📢 View on Channel', url: channelUrl }]
            ]
        };
    },

    // Comments browser page.
    // threads: [{ comment, replies: [] }] for this page
    commentsPage(confessionId, page, pages, threads) {
        const rows = [];
        threads.forEach((thread) => {
            rows.push([{ text: `↩️ Reply to #${thread.index}`, callback_data: `cn_rep_${thread.comment._id}` }]);
        });

        const nav = [];
        if (page > 0) nav.push({ text: '◀️ Prev', callback_data: `cb_${confessionId}_${page - 1}` });
        if (page < pages - 1) nav.push({ text: 'Next ▶️', callback_data: `cb_${confessionId}_${page + 1}` });
        if (nav.length) rows.push(nav);

        rows.push([
            { text: '✏️ Send Comment', callback_data: `cn_new_${confessionId}` },
            { text: '🏠 Menu', callback_data: 'm_menu' }
        ]);
        return { inline_keyboard: rows };
    },

    // Comment submitted confirmation
    commentDone(confessionId, page) {
        return {
            inline_keyboard: [
                [{ text: '💬 View Comments', callback_data: `cb_${confessionId}_${page || 0}` }],
                [{ text: '🏠 Main Menu', callback_data: 'm_menu' }]
            ]
        };
    },

    // Comment / reply preview actions
    commentPreview(confessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Submit', callback_data: `cn_sub_${confessionId}` },
                    { text: '✖️ Cancel', callback_data: `cn_can_${confessionId}` }
                ]
            ]
        };
    },

    replyPreview(commentId) {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Submit', callback_data: `cn_rsub_${commentId}` },
                    { text: '✖️ Cancel', callback_data: `cn_rcan_${commentId}` }
                ]
            ]
        };
    }
};

module.exports = keyboards;

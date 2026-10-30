// src/utils/keyboards.js
// Every inline keyboard in the bot. One design system:
//   • one emoji per action, at the start of the label
//   • primary action on its own bottom row, secondaries 2-per-row above it
//   • navigation always last:  🔙 Back  → one level up,  🏠 Menu  → main menu
//   • at most 2 buttons per row, so nothing wraps on a phone
//
// Callback data (Telegram allows 64 bytes, ids are 24 hex chars):
//   m_*      menu / profile / activity / contact
//   p_*      my confessions, my comments
//   c_*      confession flow
//   f_browse_<page>            confession feed
//   cb_/cn_/cr_/cv_*           discussion (see utils/commentView.js)
//   ct_*     contact message
//   a_*      admin hub, lists, preview, confirm requests
//   ay_*     admin: confirmed action ("yes")
//   an_*     admin: request-changes note
//   ad_*     legacy direct decisions (kept so old review messages still work)
const { TOPICS } = require('./constants');

const NAV_BACK = (callback_data = 'm_menu', label = '🏠 Main Menu') => ({ text: label, callback_data });

const keyboards = {
    /* ── main menu ──────────────────────────────────────────────── */

    mainMenu() {
        return {
            inline_keyboard: [
                [{ text: '✍️ Send a Confession', callback_data: 'c_start' }],
                [
                    { text: '💬 Browse Confessions', callback_data: 'f_browse_0' },
                    { text: '👤 My Profile', callback_data: 'm_profile' }
                ],
                [
                    { text: '📊 My Activity', callback_data: 'm_activity' },
                    { text: 'ℹ️ About', callback_data: 'm_about' }
                ],
                [{ text: '📩 Contact Admin', callback_data: 'm_contact' }]
            ]
        };
    },

    /* ── confession flow ────────────────────────────────────────── */

    topics() {
        const entries = Object.entries(TOPICS);
        const rows = [];
        for (let i = 0; i < entries.length; i += 2) {
            rows.push(entries.slice(i, i + 2).map(([key, topic]) => ({
                text: topic.label,
                callback_data: `c_topic_${key}`
            })));
        }
        rows.push([{ text: '🔙 Back', callback_data: 'c_back' }]);
        return { inline_keyboard: rows };
    },

    confessionPreview() {
        return {
            inline_keyboard: [
                [
                    { text: '✏️ Edit Confession', callback_data: 'c_edit' },
                    { text: '🗑️ Cancel', callback_data: 'c_cancel' }
                ],
                [{ text: '✅ Submit Confession', callback_data: 'c_submit' }]
            ]
        };
    },

    /* ── profile ────────────────────────────────────────────────── */

    profile() {
        return {
            inline_keyboard: [
                [{ text: '✏️ Change Nickname', callback_data: 'm_nick' }],
                [
                    { text: '📊 My Confessions', callback_data: 'p_conf_0' },
                    { text: '💬 My Comments', callback_data: 'p_com_0' }
                ],
                [NAV_BACK('m_menu', '🔙 Back to Menu')]
            ]
        };
    },

    activity() {
        return {
            inline_keyboard: [
                [
                    { text: '📊 My Confessions', callback_data: 'p_conf_0' },
                    { text: '💬 My Comments', callback_data: 'p_com_0' }
                ],
                [NAV_BACK('m_menu', '🔙 Back to Menu')]
            ]
        };
    },

    // Paginated personal lists (my confessions / my comments)
    myConfessions(page, pages) {
        return keyboards._paged('p_conf', page, pages, [
            [
                { text: '🔙 Back', callback_data: 'm_profile' },
                { text: '🏠 Main Menu', callback_data: 'm_menu' }
            ]
        ]);
    },

    myComments(page, pages) {
        return keyboards._paged('p_com', page, pages, [
            [
                { text: '🔙 Back', callback_data: 'm_profile' },
                { text: '🏠 Main Menu', callback_data: 'm_menu' }
            ]
        ]);
    },

    /* ── info screens ───────────────────────────────────────────── */

    about() {
        return {
            inline_keyboard: [
                [{ text: '📩 Contact Admin', callback_data: 'm_contact' }],
                [NAV_BACK('m_menu', '🔙 Back to Menu')]
            ]
        };
    },

    help() {
        return {
            inline_keyboard: [
                [{ text: '💬 Browse Confessions', callback_data: 'f_browse_0' }],
                [NAV_BACK('m_menu', '🔙 Back to Menu')]
            ]
        };
    },

    contactCompose() {
        return {
            inline_keyboard: [[{ text: '🗑️ Cancel', callback_data: 'ct_cancel' }]]
        };
    },

    contactPreview() {
        return {
            inline_keyboard: [
                [
                    { text: '📤 Send to Admins', callback_data: 'ct_send' },
                    { text: '🗑️ Cancel', callback_data: 'ct_cancel' }
                ]
            ]
        };
    },

    backToMenu(label = '🔙 Back to Menu') {
        return { inline_keyboard: [[NAV_BACK('m_menu', label)]] };
    },

    // Back to the profile screen (used by "My Confessions" / "My Comments")
    backToProfile() {
        return {
            inline_keyboard: [[{ text: '🔙 Back', callback_data: 'm_profile' }]]
        };
    },

    /* ── confession feed ────────────────────────────────────────── */

    feedCard(confessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '💬 Open Discussion', callback_data: `cb_${confessionId}_0` },
                    { text: '✍️ Send Comment', callback_data: `cn_new_${confessionId}` }
                ]
            ]
        };
    },

    feedHeader(page, pages) {
        return keyboards._paged('f_browse', page, pages, [
            [{ text: '✍️ Send a Confession', callback_data: 'c_start' }],
            [NAV_BACK('m_menu', '🏠 Main Menu')]
        ]);
    },

    /* ── admin ──────────────────────────────────────────────────── */

    // Live counts in the labels: a button that shows the number waiting is
    // both informative and impossible to let go stale.
    adminHub(counts = {}) {
        const n = (value) => (typeof value === 'number' ? ` · ${value}` : '');
        return {
            inline_keyboard: [
                [
                    { text: `📥 Pending${n(counts.pending)}`, callback_data: 'a_pend_0' },
                    { text: `✅ Approved${n(counts.approved)}`, callback_data: 'a_appr_0' }
                ],
                [
                    { text: `❌ Rejected${n(counts.rejected)}`, callback_data: 'a_rej_0' },
                    { text: '📊 Bot Statistics', callback_data: 'a_stats' }
                ],
                [
                    { text: '👥 User Statistics', callback_data: 'a_users' },
                    { text: '⚙️ Bot Management', callback_data: 'a_manage' }
                ],
                [NAV_BACK('m_menu', '🏠 Main Menu')]
            ]
        };
    },

    // Review message for one confession (also used inside the lists)
    adminReview(confessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '👁️ Preview', callback_data: `av_${confessionId}` },
                    { text: '✏️ Request Changes', callback_data: `a_ch_${confessionId}` }
                ],
                [
                    { text: '✅ Approve', callback_data: `a_ok_${confessionId}` },
                    { text: '❌ Reject', callback_data: `a_no_${confessionId}` }
                ]
            ]
        };
    },

    // Same actions, but on a confession that is already approved/rejected
    adminArchiveItem(confession) {
        const rows = [[{ text: '👁️ Preview', callback_data: `av_${confession._id}` }]];
        if (confession.status === 'approved') {
            rows[0].push({
                text: confession.channelPostId ? '📢 Repost' : '📢 Post to Channel',
                callback_data: `a_post_${confession._id}`
            });
        }
        return { inline_keyboard: rows };
    },

    // Same actions on the full preview screen, plus a way back to the panel.
    adminPreviewActions(confession) {
        const base = confession.status === 'pending'
            ? keyboards.adminReview(confession._id).inline_keyboard
            : keyboards.adminArchiveItem(confession).inline_keyboard;
        return {
            inline_keyboard: [...base, [{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]]
        };
    },

    // Confirmation step - never executes a decision on the first tap
    adminConfirm(confessionId, action) {
        const approve = action === 'ok';
        return {
            inline_keyboard: [
                [{
                    text: approve ? '✅ Yes, Approve' : '🗑️ Yes, Reject',
                    callback_data: `ay_${approve ? 'ok' : 'no'}_${confessionId}`
                }],
                [{ text: '🔙 Back', callback_data: `av_${confessionId}` }]
            ]
        };
    },

    adminChangesPreview(confessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '📤 Send Note', callback_data: `an_send_${confessionId}` },
                    { text: '🗑️ Cancel', callback_data: `an_cancel_${confessionId}` }
                ]
            ]
        };
    },

    adminListFor(list, page, pages) {
        const prefix = list === 'pending' ? 'a_pend' : (list === 'approved' ? 'a_appr' : 'a_rej');
        return keyboards._paged(prefix, page, pages, [
            [{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]
        ]);
    },

    adminStats() {
        return {
            inline_keyboard: [
                [
                    { text: '📥 Pending', callback_data: 'a_pend_0' },
                    { text: '👥 Users', callback_data: 'a_users' }
                ],
                [{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]
            ]
        };
    },

    adminUsers() {
        return {
            inline_keyboard: [
                [{ text: '📊 Bot Statistics', callback_data: 'a_stats' }],
                [{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]
            ]
        };
    },

    adminManage() {
        return {
            inline_keyboard: [
                [{ text: '🔄 Refresh Status', callback_data: 'a_manage' }],
                [{ text: '📊 Bot Statistics', callback_data: 'a_stats' }],
                [{ text: '🔙 Admin Panel', callback_data: 'a_hub' }]
            ]
        };
    },

    /* ── published post / notifications ─────────────────────────── */

    channelPost(confessionId, botUsername, commentCount = 0) {
        const base = `https://t.me/${String(botUsername || '').replace('@', '')}?start=`;
        const browseLabel = commentCount > 0
            ? `💬 Comments (${commentCount})`
            : '💬 Comments';
        return {
            inline_keyboard: [
                [
                    { text: browseLabel, url: `${base}cb_${confessionId}_0` },
                    { text: '✍️ Add Yours', url: `${base}cn_new_${confessionId}` }
                ]
            ]
        };
    },

    publishedNotice(channelUrl) {
        return {
            inline_keyboard: [[{ text: '📢 View on Channel', url: channelUrl }]]
        };
    },

    /* ── internal ───────────────────────────────────────────────── */

    // Shared pager: Prev/Next row (only when needed) + the caller's rows.
    _paged(prefix, page, pages, extraRows = []) {
        const rows = [];
        const nav = [];
        if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `${prefix}_${page - 1}` });
        if (page < pages - 1) nav.push({ text: 'Next ➡️', callback_data: `${prefix}_${page + 1}` });
        if (nav.length) rows.push(nav);
        return { inline_keyboard: [...rows, ...extraRows] };
    }
};

module.exports = keyboards;

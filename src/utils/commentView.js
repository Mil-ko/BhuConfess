// src/utils/commentView.js
// Rendering for the comment "discussion" UI.
//
// Telegram limits us to one inline keyboard per message, so a modern social
// feel is built out of BLOCKS: a header block plus one card per top-level
// comment. Each card owns its own reaction row, Reply button and
// View/Hide replies toggle, and is edited in place when it changes.
//
// Everything here is pure: it takes database rows and returns
// { text, extra } ready for sendMessage/editMessageText (HTML parse mode).
const { MESSAGES, REACTION_EMOJI, COMMENT_UI } = require('./constants');
const { escapeHtml, clampText, timeAgo, plural } = require('./format');

const REACTION_KEYS = Object.keys(REACTION_EMOJI);

/* ── identities ────────────────────────────────────────────────────── */

// One stable display name per person per discussion.
// The current nickname wins (so a rename updates the whole thread instead of
// leaving the same person under two names); anyone without a nickname gets a
// positional "Anon #N" in order of first appearance.
// nicknames: { [telegramId]: nickname|null }
function resolveNames(comments = [], nicknames = {}) {
    // A nickname the person used at ANY point in this discussion (not just on
    // their first comment - the very first one may predate them setting one).
    const stored = new Map();
    for (const comment of comments) {
        const id = comment.authorId ? String(comment.authorId) : null;
        if (!id || stored.has(id)) continue;
        if (comment.nickname) stored.set(id, comment.nickname);
    }

    // current nickname → a nickname stored with their comments → Anon #N,
    // numbered in order of first appearance.
    const names = new Map();
    let anon = 0;

    for (const comment of comments) {
        const id = comment.authorId ? String(comment.authorId) : null;
        if (!id || names.has(id)) continue;

        if (nicknames[id]) names.set(id, nicknames[id]);
        else if (stored.has(id)) names.set(id, stored.get(id));
        else {
            anon += 1;
            names.set(id, `Anon #${anon}`);
        }
    }

    return names;
}

function nameOf(names, authorId) {
    if (!authorId) return 'Anonymous';
    return names.get(String(authorId)) || 'Anonymous';
}

/* ── data shaping ──────────────────────────────────────────────────── */

// Chronological comments → [{ comment, index, replies }]
// index is 1-based across the WHOLE discussion (not per page) so a comment
// keeps the same number on every page.
function buildThreads(comments = []) {
    const repliesByParent = new Map();

    for (const comment of comments) {
        if (!comment.parentCommentId) continue;
        const key = String(comment.parentCommentId);
        if (!repliesByParent.has(key)) repliesByParent.set(key, []);
        repliesByParent.get(key).push(comment);
    }

    return comments
        .filter((comment) => !comment.parentCommentId)
        .map((comment, i) => ({
            comment,
            index: i + 1,
            replies: repliesByParent.get(String(comment._id)) || []
        }));
}

// The replies that fit in an expanded card (the most recent ones).
function visibleReplies(replies) {
    return replies.slice(-COMMENT_UI.MAX_REPLIES);
}

/* ── card (one message per top-level comment) ──────────────────────── */

function cardText({ index, comment, replies, names, expanded, shownReplies }) {
    const lines = [
        `💬 <b>#${index}</b> · <b>${escapeHtml(nameOf(names, comment.authorId))}</b> · <i>${timeAgo(comment.createdAt)}</i>`,
        `<blockquote>${escapeHtml(clampText(comment.text, COMMENT_UI.MAX_TEXT))}</blockquote>`
    ];

    if (replies.length) {
        if (!expanded) {
            lines.push(MESSAGES.DISCUSSION_REPLIES_HIDDEN.replace(
                '{count}',
                plural(replies.length, 'reply', 'replies')
            ));
        } else {
            for (const reply of shownReplies) {
                lines.push(`↳ <b>${escapeHtml(nameOf(names, reply.authorId))}</b> · <i>${timeAgo(reply.createdAt)}</i>`);
                lines.push(`<blockquote>${escapeHtml(clampText(reply.text, COMMENT_UI.MAX_REPLY_TEXT))}</blockquote>`);
            }
            const hidden = replies.length - shownReplies.length;
            if (hidden > 0) {
                lines.push(MESSAGES.DISCUSSION_REPLIES_MORE.replace('{count}', hidden));
            }
        }
    }

    return lines.join('\n');
}

function cardKeyboard({ comment, replies, expanded, shownReplies, names, viewerId }) {
    const rows = [];

    // Reaction row: count only when someone reacted, "✓" marks your own tap.
    const reactions = comment.reactions || {};
    rows.push(REACTION_KEYS.map((key) => {
        const ids = (reactions[key] || []).map(String);
        const mine = ids.includes(String(viewerId));
        return {
            text: `${REACTION_EMOJI[key]}${ids.length ? ' ' + ids.length : ''}${mine ? ' ✓' : ''}`,
            callback_data: `cr_${key}_${comment._id}`
        };
    }));

    const actions = [{ text: '↩️ Reply', callback_data: `cn_rep_${comment._id}` }];
    if (replies.length) {
        actions.push({
            text: expanded ? `🔼 Hide ${replies.length}` : `🔽 ${plural(replies.length, 'reply', 'replies')}`,
            callback_data: `cv_${comment._id}`
        });
    }
    rows.push(actions);

    // A reply button per visible reply - replying to a reply is allowed and
    // still lands in this thread.
    if (expanded) {
        for (const reply of shownReplies) {
            rows.push([{
                text: `↩️ Reply · ${clampText(nameOf(names, reply.authorId), 16)}`,
                callback_data: `cn_rep_${reply._id}`
            }]);
        }
    }

    return { inline_keyboard: rows };
}

// One card block, ready to send.
function cardBlock({ index, comment, replies, names, expanded, viewerId }) {
    const shownReplies = expanded ? visibleReplies(replies) : [];
    return {
        text: cardText({ index, comment, replies, names, expanded, shownReplies }),
        extra: {
            parse_mode: 'HTML',
            reply_markup: cardKeyboard({ comment, replies, expanded, shownReplies, names, viewerId })
        }
    };
}

/* ── header / empty state ──────────────────────────────────────────── */

function headerKeyboard(cid, page, pages) {
    const rows = [];
    const nav = [];

    if (page > 0) nav.push({ text: '◀️ Prev', callback_data: `cb_${cid}_${page - 1}` });
    if (page < pages - 1) nav.push({ text: 'Next ▶️', callback_data: `cb_${cid}_${page + 1}` });
    if (nav.length) rows.push(nav);

    // Always reachable, no matter which page the reader is on.
    rows.push([
        { text: '✏️ Send Comment', callback_data: `cn_new_${cid}` },
        { text: '🏠 Menu', callback_data: 'm_menu' }
    ]);

    return { inline_keyboard: rows };
}

function excerptOf(text) {
    return clampText(String(text || '').replace(/\s+/g, ' ').trim(), COMMENT_UI.MAX_EXCERPT);
}

function headerBlock({ confession, cid, page, pages, count }) {
    const pageLabel = pages > 1
        ? MESSAGES.DISCUSSION_PAGE.replace('{page}', page + 1).replace('{pages}', pages)
        : '';

    return {
        text: MESSAGES.DISCUSSION_HEADER
            .replace('{page}', pageLabel)
            .replace('{excerpt}', escapeHtml(excerptOf(confession.text)))
            .replace('{count}', plural(count, 'comment', 'comments')),
        extra: { parse_mode: 'HTML', reply_markup: headerKeyboard(cid, page, pages) }
    };
}

function emptyBlock({ confession, cid }) {
    return {
        text: MESSAGES.DISCUSSION_EMPTY.replace('{excerpt}', escapeHtml(excerptOf(confession.text))),
        extra: { parse_mode: 'HTML', reply_markup: headerKeyboard(cid, 0, 1) }
    };
}

/* ── reply / comment composition ───────────────────────────────────── */

function replyContextBlock({ name, text, commentId }) {
    return {
        text: MESSAGES.REPLY_CONTEXT
            .replace('{name}', escapeHtml(name))
            .replace('{excerpt}', escapeHtml(clampText(text, COMMENT_UI.MAX_REPLY_TEXT + 130))),
        extra: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '✖️ Cancel', callback_data: `cn_rcan_${commentId}` }]]
            }
        }
    };
}

function replyPreviewBlock({ name, excerpt, text, commentId }) {
    return {
        text: MESSAGES.REPLY_PREVIEW
            .replace('{name}', escapeHtml(name))
            .replace('{excerpt}', escapeHtml(clampText(excerpt, COMMENT_UI.MAX_REPLY_TEXT + 130)))
            .replace('{text}', escapeHtml(text)),
        extra: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Submit', callback_data: `cn_rsub_${commentId}` },
                    { text: '✖️ Cancel', callback_data: `cn_rcan_${commentId}` }
                ]]
            }
        }
    };
}

function commentPreviewBlock({ text, cid }) {
    return {
        text: MESSAGES.COMMENT_PREVIEW.replace('{text}', escapeHtml(text)),
        extra: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Submit', callback_data: `cn_sub_${cid}` },
                    { text: '✖️ Cancel', callback_data: `cn_can_${cid}` }
                ]]
            }
        }
    };
}

module.exports = {
    REACTION_KEYS,
    resolveNames,
    nameOf,
    buildThreads,
    visibleReplies,
    cardBlock,
    headerBlock,
    emptyBlock,
    replyContextBlock,
    replyPreviewBlock,
    commentPreviewBlock
};

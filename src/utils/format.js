// src/utils/format.js
// Small presentation helpers for the comment/discussion UI.
// Kept separate from validator (which is about accepting input, not showing it).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// Telegram's HTML parse mode needs &, < and > escaped in user content.
// Without this a comment containing "<3" would break the whole message.
function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/[&<>]/g, (ch) => ESCAPES[ch]);
}

// Hard truncate, adding an ellipsis only when something was actually cut.
function clampText(value, max) {
    const text = String(value === null || value === undefined ? '' : value);
    if (text.length <= max) return text;
    return text.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

// "just now" / "7m ago" / "3h ago" / "2d ago" / "17 Feb"
function timeAgo(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return 'recently';

    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

module.exports = { escapeHtml, clampText, timeAgo, plural };

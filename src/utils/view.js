// src/utils/view.js
// Shared helpers for screens that own SEVERAL messages (a discussion page, a
// confession feed, an admin list).
//
// Telegram has no "screen" concept: each message carries its own keyboard. The
// trick used here is to remember the message ids we drew and, on the next
// render, edit those messages in place, send what is new and delete what is
// left over - so paging never floods the chat and never leaves dead buttons
// behind.
const logger = require('./logger');

// blocks: [{ text, extra }] → returns the message ids that now show them.
async function replaceView(ctx, previousIds = [], blocks = []) {
    const chatId = ctx.from.id;
    const ids = [];

    for (let i = 0; i < blocks.length; i++) {
        const messageId = previousIds[i];
        const block = blocks[i];

        if (messageId) {
            try {
                await ctx.telegram.editMessageText(chatId, messageId, undefined, block.text, block.extra);
                ids.push(messageId);
                continue;
            } catch (error) {
                // past Telegram's 48h edit window, or the user deleted it
            }
        }

        try {
            const sent = await ctx.telegram.sendMessage(chatId, block.text, block.extra);
            ids.push(sent.message_id);
        } catch (error) {
            logger.warn(`Could not render view block: ${error.message}`);
        }
    }

    await deleteMessages(ctx, previousIds.slice(blocks.length));
    return ids;
}

async function deleteMessages(ctx, ids = []) {
    for (const id of ids) {
        try {
            await ctx.telegram.deleteMessage(ctx.from.id, id);
        } catch (error) {
            // already gone, or too old for the bot to touch
        }
    }
}

// Edit one message, falling back to a fresh message when Telegram refuses
// (expired message, too old, deleted). Returns the message id now in use.
async function editOrSend(ctx, messageId, text, extra) {
    if (messageId) {
        try {
            await ctx.telegram.editMessageText(ctx.from.id, messageId, undefined, text, extra);
            return messageId;
        } catch (error) {
            // fall through
        }
    }
    try {
        const sent = await ctx.telegram.sendMessage(ctx.from.id, text, extra);
        return sent.message_id;
    } catch (error) {
        logger.warn(`Could not update view: ${error.message}`);
        return null;
    }
}

// Page clamping shared by every paginated screen.
function clampPage(page, pages) {
    let p = parseInt(page, 10);
    if (isNaN(p) || p < 0) p = 0;
    const max = Math.max(0, pages - 1);
    if (p > max) p = max;
    return p;
}

function pageCount(total, perPage) {
    return Math.max(1, Math.ceil(total / perPage));
}

module.exports = { replaceView, deleteMessages, editOrSend, clampPage, pageCount };

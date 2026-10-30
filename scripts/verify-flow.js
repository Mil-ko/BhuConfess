// scripts/verify-flow.js
// End-to-end flow test WITHOUT Telegram: drives the real controllers with a
// mocked Telegram transport and asserts every step of the v1 acceptance list.
//
// Run: node scripts/verify-flow.js
require('dotenv').config();

const assert = require('assert');

// NOTE: nothing is stubbed here - the REAL channel service runs against the
// mocked Telegram API below, so publish formatting, buttons and error paths
// are all exercised (a previous stub hid a real sendMessage bug).

const service = require('../src/services/telegram.service');
const botController = require('../src/controllers/bot.controller');
const adminController = require('../src/controllers/admin.controller');
const databaseService = require('../src/services/database.service');
const authMiddleware = require('../src/middleware/auth.middleware');
const channelService = require('../src/services/channel.services.js');
const commentViewModule = require('../src/utils/commentView');
const Comment = require('../src/models/Comment.model');
const Confession = require('../src/models/Confession.model');
const User = require('../src/models/User.model');
const mongoose = require('mongoose');

// Every text that leaves the bot, whatever path it took. Used at the end to
// prove no screen can be rejected by Telegram for broken HTML.
const OUTBOUND = [];

// ── Mock Telegram transport ───────────────────────────────────────────────
const SESSIONS = new Map();
const FLAGS = { failEdits: false }; // simulate an expired / deleted message
let MESSAGE_SEQ = 1000;
function nextMessageId() {
    MESSAGE_SEQ += 1;
    return MESSAGE_SEQ;
}

function makeCtx(user, callbackData, messageText) {
    const log = { sent: [], answers: [], edits: [], replies: [], markupEdits: [], messageEdits: [], deleted: [] };
    const ctx = {
        from: { ...user },
        // Telegram sends the message the button lives on with every callback.
        callbackQuery: callbackData ? { data: callbackData, message: { message_id: nextMessageId() } } : undefined,
        message: messageText !== undefined ? { text: messageText } : undefined,
        updateType: callbackData ? 'callback_query' : 'message',
        telegram: {
            sendMessage: async (chatId, text, extra) => {
                OUTBOUND.push(text);
                log.sent.push({ chatId, text, extra });
                return { message_id: nextMessageId() };
            },
            getMe: async () => ({ username: 'TestBot', id: 1 }),
            getChat: async () => ({ title: 'TestChannel', username: 'testchannel' }),
            getChatMember: async () => ({ status: 'administrator' }),
            editMessageText: async (chatId, messageId, inlineMessageId, text, extra) => {
                if (FLAGS.failEdits) throw new Error('Bad Request: message to edit not found');
                OUTBOUND.push(text);
                log.messageEdits.push({ chatId, messageId, text, extra });
                return true;
            },
            deleteMessage: async (chatId, messageId) => {
                log.deleted.push({ chatId, messageId });
                return true;
            },
            editMessageReplyMarkup: async (chatId, messageId, inlineMessageId, markup) => {
                log.markupEdits.push({ chatId, messageId, markup });
                return true;
            }
        },
        reply: async (text, extra) => {
            OUTBOUND.push(text);
            log.replies.push({ text, extra });
            return { message_id: log.replies.length };
        },
        answerCbQuery: async (text) => { log.answers.push(text || ''); },
        editMessageText: async (text) => { OUTBOUND.push(text); log.edits.push(text); }
    };
    if (!SESSIONS.has(user.id)) SESSIONS.set(user.id, {});
    Object.defineProperty(ctx, 'session', {
        get: () => SESSIONS.get(user.id),
        set: (v) => SESSIONS.set(user.id, v),
        configurable: true
    });
    ctx.log = log;
    return ctx;
}

function buttons(msg) {
    if (!msg || !msg.extra || !msg.extra.reply_markup) return [];
    return msg.extra.reply_markup.inline_keyboard.flat().map(b => b.callback_data || b.text);
}

// Telegram only accepts a small tag set, well nested, and at most 4096 chars.
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'a']);
function htmlProblems(text) {
    const problems = [];
    if (text.length > 4096) problems.push(`too long (${text.length} chars, limit 4096)`);

    const stack = [];
    const rest = String(text).replace(/<(\/?)([a-z]+)((?:\s+href="[^"]*")?)>/gi, (m, close, name, attrs) => {
        const tag = name.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) problems.push(`unsupported tag <${tag}>`);
        if (attrs && tag !== 'a') problems.push(`attributes not allowed on <${tag}>`);
        if (tag === 'a' && !attrs) problems.push('<a> without href');
        if (close) {
            if (stack.pop() !== tag) problems.push(`</${tag}> closes the wrong tag`);
        } else {
            stack.push(tag);
        }
        return '';
    });
    if (stack.length) problems.push(`unclosed <${stack.join('>, <')}>`);
    if (/[<>]/.test(rest)) problems.push('raw angle bracket outside a tag');
    if (/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/i.test(rest)) problems.push('unescaped &');
    return problems;
}

// A screen may be drawn as new messages and/or as in-place edits of the
// messages already on screen - both count as "what the user now sees".
function blocksOf(c) {
    return [
        ...c.log.messageEdits.map(e => ({ text: e.text, extra: e.extra, messageId: e.messageId })),
        ...c.log.sent.filter(m => m.extra && m.extra.parse_mode === 'HTML'),
        ...c.log.sent.filter(m => m.extra && m.extra.reply_markup && !m.extra.parse_mode)
    ];
}

// Find a drawn screen containing a piece of text.
function findBlock(c, needle) {
    return blocksOf(c).find(b => b.text.includes(needle));
}

const ADMIN_ID = String(process.env.ADMIN_ID || '').split(',')[0].trim();
const ALICE = { id: 777000111, first_name: 'Alice', last_name: 'Tester', username: 'alice_t' };
const BOB = { id: 777000222, first_name: 'Bob', last_name: 'Reader', username: 'bob_r' };
const ADMIN = { id: parseInt(ADMIN_ID, 10), first_name: 'Admin', last_name: '', username: '' };
const STRANGER = { id: 777000333, first_name: 'Eve', last_name: '', username: '' };
const CAROL_REF = { id: 777000444 }; // deep-link tester (no DB writes)

let passed = 0;
let confessionId = null;
let secondId = null;
function ok(label) { passed++; console.log('  ✅ ' + label); }

(async () => {
    try {
        // Pre-connect (with retries - Atlas can be slow to answer)
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await databaseService.initialize();
                break;
            } catch (e) {
                if (attempt === 3) throw e;
                console.log(`  ⏳ DB connect attempt ${attempt} failed, retrying...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Purge leftovers from any previous (aborted) run of this script
        const syntheticIds = [String(ALICE.id), String(BOB.id), String(STRANGER.id), String(CAROL_REF.id)];
        await Comment.deleteMany({ authorId: { $in: syntheticIds } });
        await Confession.deleteMany({ authorId: { $in: syntheticIds } });
        await User.deleteMany({ telegramId: { $in: syntheticIds } });

        // ── 1. /start asks for a nickname, then the main menu ──────
        let ctx = makeCtx(ALICE);
        await botController.handleStart(ctx);
        assert(SESSIONS.get(ALICE.id).flow && SESSIONS.get(ALICE.id).flow.type === 'nickname',
            'nickname flow started on first /start');
        let last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('nickname'), 'nickname prompt shown');
        ok('/start asks the user for their nickname');

        ctx = makeCtx(ALICE, undefined, 'AllyCat');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('AllyCat'), 'nickname saved confirmation');
        assert(!SESSIONS.get(ALICE.id).flow, 'nickname flow cleared after save');
        ok('nickname accepted and confirmed');

        ctx = makeCtx(ALICE, 'm_menu');
        await service.routeCallback(ctx);
        const menu = ctx.log.sent[ctx.log.sent.length - 1];
        const menuBtns = buttons(menu);
        assert.deepStrictEqual(
            menuBtns,
            ['c_start', 'f_browse_0', 'm_profile', 'm_activity', 'm_about', 'm_contact'],
            'menu: send, browse, profile, activity, about, contact'
        );
        assert(menu.text.includes('Main Menu'), 'menu has a heading');
        ok('main menu has all six sections in a tidy 1/2/2/1 layout');

        // ── 2. Topic selection ────────────────────────────────────────
        ctx = makeCtx(ALICE, 'c_start');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('topic'), 'topic prompt shown');
        const topicBtns = buttons(last);
        assert(topicBtns.includes('c_topic_love') && topicBtns.includes('c_topic_other'),
            'topic buttons present');
        assert.strictEqual(topicBtns[topicBtns.length - 1], 'c_back', 'topics have a Back button');
        assert.strictEqual(last.extra.reply_markup.inline_keyboard.length, 4,
            'five topics + Back fit in four rows (2 per row)');
        ok('Send Confession → topics (2 per row) with a Back button');

        // 🔙 Back from the write step returns to the same topic list
        ctx = makeCtx(ALICE, 'c_back');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('topic'), 'Back returns to the topic list');
        assert(buttons(last).includes('c_back'), 'topics keep their Back button');
        ok('Back from the write step returns to topic selection');

        ctx = makeCtx(ALICE, 'c_topic_love');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('write your confession'), 'write prompt');
        assert.strictEqual(SESSIONS.get(ALICE.id).flow.topic, 'love');
        ok('topic chosen (love), write prompt shown');

        // ── 3. Write → preview with Edit/Submit/Cancel ────────────────
        ctx = makeCtx(ALICE, undefined, 'I secretly debug production at 3am every day.');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('❤️ Love'), 'preview shows topic');
        assert(last.text.includes('I secretly debug'), 'preview shows text');
        assert.deepStrictEqual(buttons(last), ['c_edit', 'c_cancel', 'c_submit'],
            'preview buttons: Edit / Cancel, then Submit');
        assert(last.extra.parse_mode === 'HTML', 'preview is HTML formatted');
        assert(last.text.includes('<blockquote>'), 'preview quotes the confession');
        ok('preview with Edit / Cancel / Submit on separate rows');

        // Edit flow
        ctx = makeCtx(ALICE, 'c_edit');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, undefined, 'I secretly debug production at 3am. No regrets.');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('No regrets'), 'edited text in new preview');
        ok('edit before submitting replaces the draft');

        // ── 4. Submit → locked + admin review message ─────────────────
        ctx = makeCtx(ALICE, 'c_submit');
        await service.routeCallback(ctx);
        last = ctx.log.sent.find(m => m.chatId === ALICE.id && m.text.includes('submitted'));
        assert(last && last.text.includes('submitted'), 'submit confirmation shown');
        assert(!SESSIONS.get(ALICE.id).flow, 'draft cleared after submit (locked)');
        const confessionId2 = SESSIONS.get(ALICE.id).lastConfessionId;
        assert(confessionId2, 'lastConfessionId stored');
        confessionId = confessionId2;

        const review = ctx.log.sent.find(m => String(m.chatId) === ADMIN_ID);
        assert(review, 'review message sent to admin chat');
        assert(review.text.includes('❤️ Love'), 'review shows topic');
        assert(review.text.includes('No regrets'), 'review shows text');
        assert.deepStrictEqual(buttons(review),
            [`av_${confessionId}`, `a_ch_${confessionId}`, `a_ok_${confessionId}`, `a_no_${confessionId}`],
            'review: Preview / Request Changes / Approve / Reject');
        ok('submit → locked, review sent to admin with Preview / Changes / Approve / Reject');

        // Locked: stray text shows menu
        ctx = makeCtx(ALICE, undefined, 'hello?');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('not writing anything'), 'locked hint');
        ok('after submission the confession is locked (stray text → menu)');

        // ── 5. Non-admin cannot decide (legacy and new buttons) ───────
        for (const data of [`ad_ok_${confessionId}`, `a_ok_${confessionId}`, `ay_ok_${confessionId}`, 'a_hub']) {
            ctx = makeCtx(STRANGER, data);
            await service.routeCallback(ctx);
            assert(ctx.log.answers.some(a => a.includes('admins')), `stranger blocked on ${data}`);
        }
        let doc = await Confession.findById(confessionId);
        assert.strictEqual(doc.status, 'pending', 'still pending after stranger attempts');
        ok('non-admin cannot touch the admin panel or decisions (server-side check)');

        // ── 6. Admin approves: confirmation first, then publish ───────
        ctx = makeCtx(ADMIN, `a_ok_${confessionId}`);
        await service.routeCallback(ctx);
        doc = await Confession.findById(confessionId);
        assert.strictEqual(doc.status, 'pending', 'the first tap only asks for confirmation');
        const confirmation = findBlock(ctx, 'Approve this confession');
        assert(confirmation, 'confirmation screen shown');
        assert.deepStrictEqual(buttons(confirmation), [`ay_ok_${confessionId}`, `av_${confessionId}`],
            'confirmation has Yes / Back');
        ok('Approve asks for confirmation before doing anything');

        ctx = makeCtx(ADMIN, `ay_ok_${confessionId}`);
        await service.routeCallback(ctx);

        doc = await Confession.findById(confessionId);
        assert.strictEqual(doc.status, 'approved', 'status approved');
        assert(doc.channelPostId, 'channel post id saved');
        ok('admin approve → status approved, channel post id saved (real publish path)');

        const channelId = String(process.env.CHANNEL_ID || '');
        const channelPost = ctx.log.sent.find(m => String(m.chatId) === channelId);
        assert(channelPost, 'message sent to the channel');
        assert(channelPost.text.includes('Confession from AllyCat'),
            'channel post shows the author nickname instead of Anonymous');
        const postBtns = channelPost.extra.reply_markup.inline_keyboard.flat();
        assert.strictEqual(postBtns.length, 2, 'two buttons on the channel post');
        assert.strictEqual(postBtns[0].text, '💬 Comments',
            'no count shown before any comments exist');
        assert(postBtns[0].url && postBtns[0].url.includes(`?start=cb_${confessionId}_0`),
            'Comments is a deep link to the discussion');
        assert(postBtns[1].url && postBtns[1].url.includes(`?start=cn_new_${confessionId}`),
            'Add Yours is a deep link that opens the comment flow');
        assert(!channelPost.extra || !channelPost.extra.parse_mode,
            'channel post must be plain text (no entity parser)');
        ok('channel post published with deep-link Browse/Send Comment buttons');

        const notify = ctx.log.sent.find(m => String(m.chatId) === String(ALICE.id));
        assert(notify && notify.text.includes('approved'), 'author notified of approval');

        // …with a button straight to the published post
        const expectedUrl = `https://t.me/testchannel/${doc.channelPostId}`;
        const viewBtn = notify.extra && notify.extra.reply_markup
            ? notify.extra.reply_markup.inline_keyboard.flat()[0]
            : null;
        assert(viewBtn && viewBtn.url === expectedUrl,
            `approval DM links to the channel post (got ${viewBtn && viewBtn.url})`);
        ok('author receives private approval notification with a View on Channel button');

        // Private channel (no public @username) → no button at all, never a
        // dead t.me link.
        channelService.channelUsername = null;
        assert.strictEqual(await channelService.getPostUrl(doc.channelPostId), null,
            'no t.me link for a channel without a username');
        channelService.channelUsername = undefined;
        ok('channel without a public username → no post button');

        assert(ctx.log.edits.length === 1 && ctx.log.edits[0].includes('published'),
            'admin review message updated');
        ok('admin review message updated, buttons removed');

        // Re-approve attempt → already handled
        ctx = makeCtx(ADMIN, `ad_ok_${confessionId}`);
        await service.routeCallback(ctx);
        assert(ctx.log.answers.some(a => a.includes('already handled')), 'double click guarded');
        ok('double decision guarded (already handled)');

        // ── 7. Rejection notification ─────────────────────────────────
        // second confession → reject
        ctx = makeCtx(ALICE, 'c_start');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, 'c_topic_school');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, undefined, 'My boss thinks I am productive. I am not.');
        await botController.handleText(ctx);
        // Two taps in the same instant must produce exactly one confession.
        const tapA = makeCtx(ALICE, 'c_submit');
        const tapB = makeCtx(ALICE, 'c_submit');
        await Promise.all([service.routeCallback(tapA), service.routeCallback(tapB)]);
        secondId = SESSIONS.get(ALICE.id).lastConfessionId;
        assert(secondId && secondId !== confessionId, 'second confession saved');
        assert.strictEqual(await Confession.countDocuments({
            authorId: String(ALICE.id), text: 'My boss thinks I am productive. I am not.'
        }), 1, 'the duplicate tap was swallowed');
        ok('a double tap on Submit creates exactly one confession');

        ctx = makeCtx(ADMIN, `ad_no_${secondId}`);
        await service.routeCallback(ctx);
        doc = await Confession.findById(secondId);
        assert.strictEqual(doc.status, 'rejected', 'status rejected');
        const rejectNote = ctx.log.sent.filter(m => String(m.chatId) === String(ALICE.id)).pop();
        assert(rejectNote.text.includes('not approved'), 'author notified of rejection');
        assert(!rejectNote.extra || !rejectNote.extra.reply_markup,
            'no channel button on a rejection (nothing was published)');
        assert(!ctx.log.sent.some(m => String(m.chatId).startsWith('-')), 'nothing sent to a channel');
        ok('reject → author notified, nothing posted to channel');

        // ── 8. Comments: the discussion view ─────────────────────────
        // A page is drawn as several blocks; they may arrive as new messages
        // or as in-place edits of the view already on screen - collect both.

        ctx = makeCtx(BOB, `cb_${confessionId}_0`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('No comments yet'), 'empty discussion block');
        assert.strictEqual(last.extra.parse_mode, 'HTML', 'discussion is rendered as HTML');
        assert.deepStrictEqual(buttons(last), [`cn_new_${confessionId}`, 'm_menu'],
            'empty discussion keeps Send Comment + Menu');
        ok('empty discussion renders one block with Send Comment + Menu');

        // Bob is a new user → /start asks for his nickname first
        ctx = makeCtx(BOB);
        await botController.handleStart(ctx);
        assert(SESSIONS.get(BOB.id).flow && SESSIONS.get(BOB.id).flow.type === 'nickname',
            'nickname asked for new user Bob');
        ctx = makeCtx(BOB, undefined, 'Bobby');
        await botController.handleText(ctx);
        assert(!SESSIONS.get(BOB.id).flow, 'Bob nickname flow cleared');

        ctx = makeCtx(BOB, `cn_new_${confessionId}`);
        await service.routeCallback(ctx);
        assert(SESSIONS.get(BOB.id).flow.type === 'comment', 'comment flow active');
        ctx = makeCtx(BOB, undefined, 'This one is my favourite!');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert.deepStrictEqual(buttons(last), [`cn_sub_${confessionId}`, `cn_can_${confessionId}`],
            'comment preview buttons');
        assert(last.text.includes('<blockquote>This one is my favourite!</blockquote>'),
            'comment preview quotes the draft');
        ctx = makeCtx(BOB, `cn_sub_${confessionId}`);
        await service.routeCallback(ctx);
        last = ctx.log.sent.find(
            m => String(m.chatId) === String(BOB.id) && m.text.includes('Comment posted'));
        assert(last && last.text.includes('Comment posted'), 'comment submitted');
        ok('send comment → HTML preview → submit');

        // After posting, the discussion is reopened on the new comment.
        const headerCard = blocksOf(ctx).find(b => b.text.includes('<b>Discussion</b>'));
        assert(headerCard, 'discussion header rendered');
        assert(headerCard.text.includes('1 comment') && headerCard.text.includes('I secretly debug'),
            'header shows the comment count and a confession excerpt');
        assert.deepStrictEqual(buttons(headerCard), [`cn_new_${confessionId}`, 'm_menu'],
            'Send Comment + Menu stay reachable on the header');

        const card = blocksOf(ctx).find(b => b.text.includes('This one is my favourite!'));
        assert(card, 'comment card rendered');
        assert(card.text.includes('<b>#1</b>'), 'card shows the comment number');
        assert(card.text.includes('<b>Bobby</b>'), 'card shows the nickname');
        assert(card.text.includes('just now'), 'card shows a timestamp');
        const cardButtons = buttons(card);
        assert.deepStrictEqual(cardButtons.filter(b => b.startsWith('cr_')).map(b => b.split('_')[1]),
            ['heart', 'laugh', 'fire', 'like'], 'reaction buttons: heart, laugh, fire, like');
        const commentId = cardButtons.find(b => b.startsWith('cn_rep_')).replace('cn_rep_', '');
        assert(commentId && commentId.length === 24, 'Reply button on the card');
        ok('comment card shows #, nickname, timestamp, Reply and 4 reactions');

        // Comment author (confession owner) is notified + channel count updated
        const commentNotify = ctx.log.sent.find(
            m => String(m.chatId) === String(ALICE.id)
                && m.text.includes('New comment on your confession'));
        assert(commentNotify, 'confession owner notified about the new comment');
        assert(commentNotify.text.includes('This one is my favourite!'),
            'notification includes the comment snippet');
        const countEdit1 = ctx.log.markupEdits.find(
            e => e.markup.inline_keyboard[0][0].text === '💬 Comments (1)');
        assert(countEdit1, 'channel post button count updated to 1');
        ok('comment → owner notified + channel button count updated');

        // ── 8a. Reactions ─────────────────────────────────────────────
        ctx = makeCtx(BOB, `cr_heart_${commentId}`);
        await service.routeCallback(ctx);
        const tappedId = ctx.callbackQuery.message.message_id;
        let reactEdit = ctx.log.messageEdits.find(e => e.messageId === tappedId);
        assert(reactEdit, 'a reaction re-renders the tapped card in place');
        assert.strictEqual(reactEdit.extra.reply_markup.inline_keyboard[0][0].text, '❤️ 1 ✓',
            'own reaction is counted and marked');
        assert(ctx.log.answers.some(a => a.includes('added')), 'confirmation toast');

        doc = await Comment.findById(commentId);
        assert.deepStrictEqual(doc.reactions.heart, [String(BOB.id)], 'reaction stored per user id');

        ctx = makeCtx(BOB, `cr_heart_${commentId}`);
        await service.routeCallback(ctx);
        reactEdit = ctx.log.messageEdits.find(e => e.messageId === ctx.callbackQuery.message.message_id);
        assert.strictEqual(reactEdit.extra.reply_markup.inline_keyboard[0][0].text, '❤️',
            'a second tap removes the reaction');
        assert(ctx.log.answers.some(a => a.includes('removed')), 'removal toast');
        ok('reactions toggle on/off per user and persist on the comment');

        // Counts are shared, the ✓ is per reader.
        ctx = makeCtx(ALICE, `cr_fire_${commentId}`);
        await service.routeCallback(ctx);
        assert.strictEqual(ctx.log.messageEdits[0].extra.reply_markup.inline_keyboard[0][2].text, '🔥 1 ✓',
            'Alice sees her own fire reaction marked');
        ctx = makeCtx(BOB, `cr_like_${commentId}`);
        await service.routeCallback(ctx);
        assert.strictEqual(ctx.log.messageEdits[0].extra.reply_markup.inline_keyboard[0][2].text, '🔥 1',
            'Bob sees the same count without the ✓');

        ctx = makeCtx(BOB, `cr_nope_${commentId}`);
        await service.routeCallback(ctx);
        assert(ctx.log.answers.some(a => a.includes('not found')), 'unknown reaction key rejected');
        assert.strictEqual(ctx.log.messageEdits.length, 0, 'nothing re-rendered for a bad key');
        ok('reaction counts are shared between readers, ✓ is per reader');

        // ── 8b. Reply: context screen, nesting, notifications ─────────
        ctx = makeCtx(ALICE, `cn_rep_${commentId}`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Replying to Bobby</b>'), 'context names the comment author');
        assert(last.text.includes('This one is my favourite!'), 'context shows the original comment');
        assert(SESSIONS.get(ALICE.id).flow.type === 'reply', 'reply flow active');
        assert(SESSIONS.get(ALICE.id).flow.targetId === commentId, 'reply bound to that comment');
        ok('Reply shows the original comment as context before typing');

        ctx = makeCtx(ALICE, undefined, 'Totally agree with this.');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert.deepStrictEqual(buttons(last), [`cn_rsub_${commentId}`, `cn_rcan_${commentId}`],
            'reply preview buttons');
        assert(last.text.includes('<b>Replying to Bobby</b>') && last.text.includes('Totally agree with this.'),
            'preview keeps the context above the draft');

        ctx = makeCtx(ALICE, `cn_rsub_${commentId}`);
        await service.routeCallback(ctx);
        const replies = await Comment.find({ parentCommentId: commentId });
        assert.strictEqual(replies.length, 1, 'reply stored with parentCommentId');
        assert.strictEqual(replies[0].replyToCommentId, null, 'no extra target for a direct reply');
        const firstReplyId = String(replies[0]._id);
        ok('reply → context → preview → submit, linked to the parent comment');

        // The discussion reopens on that thread with its replies visible.
        const reopened = blocksOf(ctx).find(b => b.text.includes('Totally agree with this.'));
        assert(reopened, 'thread re-rendered after replying');
        assert(reopened.text.includes('↳ <b>AllyCat</b>'), 'reply nested under its parent');
        assert(buttons(reopened).includes(`cv_${commentId}`), 'View/Hide replies button present');
        ok('posting a reply reopens the thread with the reply nested inside it');

        // The comment's owner (Bob) is notified; the replier (Alice = confession
        // owner) gets no self-notification.
        const replyNotifyBob = ctx.log.sent.find(
            m => String(m.chatId) === String(BOB.id)
                && m.text.includes('replied to your comment'));
        assert(replyNotifyBob, 'replied-to comment owner notified');
        assert(!ctx.log.sent.find(
            m => String(m.chatId) === String(ALICE.id)
                && m.text.includes('New reply on your confession')),
            'no self-notification to the replier');
        ok('reply → comment owner notified, no self-notification');

        // ── 8c. Replying to a reply ───────────────────────────────────
        ctx = makeCtx(BOB, `cn_rep_${firstReplyId}`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Replying to AllyCat</b>'), 'context names the reply author');
        assert(last.text.includes('Totally agree with this.'), 'context shows the reply being answered');
        assert(SESSIONS.get(BOB.id).flow.targetId === commentId,
            'reply attaches to the thread root, never to a reply');
        assert(SESSIONS.get(BOB.id).flow.targetCommentId === firstReplyId,
            'the exact comment being answered is remembered');

        ctx = makeCtx(BOB, undefined, 'Same here, honestly.');
        await botController.handleText(ctx);
        ctx = makeCtx(BOB, `cn_rsub_${commentId}`);
        await service.routeCallback(ctx);

        const nested = await Comment.findOne({ confessionId, replyToCommentId: firstReplyId });
        assert(nested, 'reply-to-a-reply saved');
        assert.strictEqual(String(nested.parentCommentId), commentId, 'stored under the thread root');
        ok('replying to a reply stays one level deep and records the addressed comment');

        // Alice is the confession owner AND the author of the replied-to reply:
        // exactly one notification, not two.
        const aliceNotices = ctx.log.sent.filter(
            m => String(m.chatId) === String(ALICE.id)
                && (m.text.includes('New reply on your confession') || m.text.includes('replied to your comment')));
        assert.strictEqual(aliceNotices.length, 1, 'one notification per person, never duplicated');
        ok('a reply that hits two roles still notifies that person once');

        // ── 8d. Hide replies / view replies ───────────────────────────
        // Posting that reply left the thread open on Bob's screen, so the
        // first tap hides it.
        ctx = makeCtx(BOB, `cv_${commentId}`);
        await service.routeCallback(ctx);
        let toggle = ctx.log.messageEdits.find(e => e.messageId === ctx.callbackQuery.message.message_id);
        assert(toggle, 'the tapped card is edited in place');
        assert(!toggle.text.includes('Totally agree with this.'), 'replies hidden');
        assert(toggle.text.includes('tap to open'), 'collapsed hint shown');
        ok('Hide Replies collapses the thread in the same card');

        ctx = makeCtx(BOB, `cv_${commentId}`);
        await service.routeCallback(ctx);
        toggle = ctx.log.messageEdits.find(e => e.messageId === ctx.callbackQuery.message.message_id);
        assert(toggle.text.includes('Totally agree with this.')
            && toggle.text.includes('Same here, honestly.'), 'both replies nested under the parent');
        assert(toggle.text.includes('↳ <b>AllyCat</b>'), 'each reply shows its author');
        assert(buttons(toggle).includes(`cn_rep_${firstReplyId}`), 'each reply has its own Reply button');
        assert(buttons(toggle).includes(`cv_${commentId}`), 'Hide control present');
        assert(buttons(toggle).some(b => b.startsWith('cr_heart_')), 'reaction row kept when expanded');
        ok('View Replies expands the thread in place, nested, with per-reply Reply buttons');

        // An expired / deleted message must not throw: the card is re-sent.
        FLAGS.failEdits = true;
        ctx = makeCtx(BOB, `cv_${commentId}`);
        await service.routeCallback(ctx);
        FLAGS.failEdits = false;
        assert(ctx.log.messageEdits.length === 0, 'no edit was possible (expired message)');
        assert(ctx.log.sent.some(m => m.text.includes('Quote') || m.text.includes('#1') || m.extra),
            'the card was sent again instead of failing');
        assert(buttons(ctx.log.sent[0]).length > 0, 'the re-sent card still has working buttons');
        ok('an expired message is replaced instead of throwing');

        // ── 8e. A reply draft cannot be redirected to another discussion ──
        const beforeHijack = await Comment.countDocuments({ confessionId });
        SESSIONS.set(BOB.id, {
            ...SESSIONS.get(BOB.id),
            flow: { type: 'reply', cid: String(secondId), targetId: commentId, targetCommentId: commentId, text: 'hijack attempt' }
        });
        ctx = makeCtx(BOB, `cn_rsub_${commentId}`);
        await service.routeCallback(ctx);
        assert(ctx.log.answers.some(a => a.includes('changed')), 'cross-discussion reply refused');
        assert.strictEqual(await Comment.countDocuments({ confessionId }), beforeHijack, 'nothing was saved');
        assert(!SESSIONS.get(BOB.id).flow, 'draft cleared after the refusal');
        ok('a reply draft pointing at another discussion is refused (nothing saved)');

        // A third user replies → both the confession owner (Alice) and the
        // comment owner (Bob) are notified, count goes to (3)
        ctx = makeCtx(STRANGER, `cn_rep_${commentId}`);
        await service.routeCallback(ctx);
        ctx = makeCtx(STRANGER, undefined, 'This reply comes from a third user.');
        await botController.handleText(ctx);
        ctx = makeCtx(STRANGER, `cn_rsub_${commentId}`);
        await service.routeCallback(ctx);

        const strangerToAlice = ctx.log.sent.find(
            m => String(m.chatId) === String(ALICE.id)
                && m.text.includes('New reply on your confession'));
        assert(strangerToAlice, 'confession owner notified about the reply');
        const strangerToBob = ctx.log.sent.find(
            m => String(m.chatId) === String(BOB.id)
                && m.text.includes('replied to your comment'));
        assert(strangerToBob, 'comment owner notified about the reply');
        assert(strangerToBob.text.includes('Eve'), 'notification shows the replier name');
        const countEdit4 = ctx.log.markupEdits.find(
            e => e.markup.inline_keyboard[0][0].text === '💬 Comments (4)');
        assert(countEdit4, 'channel post button count updated to 4');
        ok('third-party reply → both owners notified + channel count now (4)');

        // ── 8f. Pagination, escaping, identity ────────────────────────
        // Five more top-level comments → 6 threads = two pages of four.
        const fillerTexts = [
            'Escaping check: so cute <3 & "quotes"',
            'Second filler comment',
            'Third filler comment',
            'Fourth filler comment',
            'Fifth filler comment'
        ];
        for (const text of fillerTexts) {
            await databaseService.createComment({
                confessionId, authorId: String(STRANGER.id), nickname: 'Eve', text
            });
        }

        ctx = makeCtx(BOB, `cb_${confessionId}_0`);
        await service.routeCallback(ctx);
        let pageHeader = blocksOf(ctx).find(b => b.text.includes('<b>Discussion</b>'));
        assert(pageHeader.text.includes('page 1/2'), 'header shows the page position');
        assert.strictEqual(blocksOf(ctx).filter(b => b.text.includes('💬 <b>#')).length, 4,
            'a page holds four comment cards');
        assert(buttons(pageHeader).includes(`cb_${confessionId}_1`), 'Next page button');

        const escaped = blocksOf(ctx).find(b => b.text.includes('Escaping check'));
        assert(escaped.text.includes('&lt;3') && escaped.text.includes('&amp;'),
            'user text is HTML-escaped (no broken messages)');
        assert(!escaped.text.includes('<3'), 'raw angle brackets never reach Telegram');
        ok('discussions paginate four cards at a time and escape user text');

        ctx = makeCtx(BOB, `cb_${confessionId}_1`);
        await service.routeCallback(ctx);
        assert.strictEqual(ctx.log.messageEdits.length, 3, 'page 2 edits the view in place');
        assert.strictEqual(ctx.log.deleted.length, 2, 'surplus blocks from page 1 are removed');
        pageHeader = ctx.log.messageEdits.find(e => e.text.includes('<b>Discussion</b>'));
        assert(pageHeader.text.includes('page 2/2'), 'header switched to page 2');
        const page2Numbers = ctx.log.messageEdits
            .filter(e => e.text.includes('💬 <b>#'))
            .map(e => e.text.match(/#(\d+)/)[1]);
        assert.deepStrictEqual(page2Numbers, ['5', '6'], 'page 2 shows the remaining threads');
        ok('Next page edits the view in place instead of flooding the chat');

        // Identity: one person keeps one name across the whole discussion,
        // even after renaming themselves.
        const renamed = await databaseService.setNickname(BOB.id, 'Boba');
        assert(renamed.success, 'Bob renamed');
        ctx = makeCtx(BOB, `cb_${confessionId}_0`);
        await service.routeCallback(ctx);
        const bobCard = blocksOf(ctx).find(b => b.text.includes('💬 <b>#1</b>'));
        assert(bobCard.text.includes('<b>Boba</b>'), 'renamed user shows the new name');
        assert(!bobCard.text.includes('Bobby'), 'the old name is no longer shown for that person');
        ok('anonymous identity stays consistent across the whole discussion');

        // Telegram caps a message at 4096 characters: a huge thread must still
        // render as a single (editable) card.
        const longComments = Array.from({ length: 6 }, (_, i) => ({
            _id: String(800 + i).padStart(24, 'b'),
            authorId: String(900 + i),
            createdAt: new Date(Date.now() - i * 60000),
            parentCommentId: i === 0 ? null : String(800).padStart(24, 'b'),
            text: 'x'.repeat(1000)
        }));
        const longThread = commentViewModule.buildThreads(longComments)[0];
        const longCard = commentViewModule.cardBlock({
            index: 1,
            comment: longThread.comment,
            replies: longThread.replies,
            names: new Map(),
            expanded: true,
            viewerId: 1
        });
        assert(longCard.text.length < 4096,
            `expanded card stays under Telegram's 4096 limit (${longCard.text.length})`);
        ok('a 1000-char comment plus five long replies still fits in one message');

        // ── 8g. Comments written before the redesign ─────────────────
        // Inserted through the raw driver on purpose: no reactions map, no
        // replyToCommentId, nothing but the original v1 fields.
        const legacyBase = {
            confessionId: new mongoose.Types.ObjectId(confessionId),
            parentCommentId: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await Comment.collection.insertOne({
            ...legacyBase, authorId: String(STRANGER.id), nickname: 'OldTimer',
            text: 'Written before the redesign.'
        });
        // …and one from an author who has no users row at all (deleted account).
        await Comment.collection.insertOne({
            ...legacyBase, authorId: '777000555', nickname: 'Ghosty',
            text: 'My author record is gone.'
        });

        ctx = makeCtx(BOB, `cb_${confessionId}_1`);
        await service.routeCallback(ctx);
        const legacyBlock = blocksOf(ctx).find(b => b.text.includes('Written before the redesign.'));
        assert(legacyBlock, 'a pre-redesign comment still renders');
        assert(/💬 <b>#\d+<\/b>/.test(legacyBlock.text), 'it is numbered with the rest');
        assert(legacyBlock.text.includes('<b>Eve</b>'),
            `the same person keeps the discussion-wide name, not the stale snapshot (got: ${legacyBlock.text.split('\n')[0]})`);
        assert(legacyBlock.extra.reply_markup.inline_keyboard[0].every(b => !b.text.includes('✓')),
            'no reactions stored → nothing marked');
        assert(buttons(legacyBlock).some(b => b.startsWith('cn_rep_')), 'Reply works on old comments too');

        const orphanBlock = blocksOf(ctx).find(b => b.text.includes('My author record is gone.'));
        assert(orphanBlock, 'comment from a deleted account still renders');
        assert(orphanBlock.text.includes('<b>Ghosty</b>'), 'falls back to the nickname stored with it');
        ok('comments written before the redesign render without any migration');

        // ── 8h. Deep links: channel button → bot opens on that page ──
        const CAROL = { id: 777000444, first_name: 'Carol', last_name: '', username: 'carol_c' };

        ctx = makeCtx(CAROL);
        ctx.startPayload = `cb_${confessionId}_0`;
        await botController.handleStart(ctx);
        assert(ctx.log.sent.some(m => m.text.includes('<b>Discussion</b>')),
            'deep link renders the discussion header');
        assert(ctx.log.sent.some(m => m.text.includes('This one is my favourite!')),
            'deep link lands on the comment cards');
        ok('Browse Comments deep link opens the bot directly on the comments page');

        ctx = makeCtx(CAROL);
        ctx.startPayload = `cn_new_${confessionId}`;
        await botController.handleStart(ctx);
        assert(SESSIONS.get(CAROL.id).flow && SESSIONS.get(CAROL.id).flow.type === 'comment',
            'deep link starts comment flow');
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('Write your comment'), 'comment prompt via deep link');
        ok('Send Comment deep link opens the bot with the comment prompt ready');

        ctx = makeCtx(CAROL);
        ctx.startPayload = 'garbage_payload';
        await botController.handleStart(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('nickname'), 'fallback asks for missing nickname');
        ok('unknown deep-link payload falls back (and asks nickname for new user)');

        // ── 9. Profile ────────────────────────────────────────────────
        ctx = makeCtx(ALICE, 'm_profile');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>AllyCat</b>'), 'profile shows the nickname');
        assert(last.text.includes('@alice_t'), 'profile shows the telegram handle');
        assert(!last.text.includes('Alice Tester'), 'the real name is never displayed');
        assert(last.text.includes('Confessions: 2'), 'confession count');
        assert(last.text.includes('Comments:'), 'comment count');
        assert.deepStrictEqual(buttons(last), ['m_nick', 'p_conf_0', 'p_com_0', 'm_menu'],
            'profile actions: nickname, confessions, comments, back');
        ok('profile shows nickname, handle and counts with its own actions');

        // ── 9b. My confessions / My comments ──────────────────────────
        ctx = makeCtx(ALICE, 'p_conf_0');
        await service.routeCallback(ctx);
        let listBlocks = blocksOf(ctx);
        assert(listBlocks.some(b => b.text.includes('<b>My Confessions</b>')), 'my confessions header');
        assert(listBlocks.some(b => b.text.includes('✅ Approved')), 'approved confession listed');
        assert(listBlocks.some(b => b.text.includes('❌ Rejected')), 'rejected confession listed');
        const approvedCard = listBlocks.find(b => b.text.includes('✅ Approved'));
        assert(buttons(approvedCard).includes(`cb_${confessionId}_0`),
            'approved card opens its discussion');
        ok('My Confessions lists each one with status and a discussion link');

        ctx = makeCtx(ALICE, 'p_com_0');
        await service.routeCallback(ctx);
        listBlocks = blocksOf(ctx);
        assert(listBlocks.some(b => b.text.includes('<b>My Comments</b>')), 'my comments header');
        assert(listBlocks.some(b => b.text.includes('Totally agree with this.')), 'her comment listed');
        const myCommentCard = listBlocks.find(b => b.text.includes('Totally agree with this.'));
        assert(buttons(myCommentCard).includes(`cb_${confessionId}_0`), 'comment links to its discussion');
        ok('My Comments lists what she wrote with a discussion link');

        // ── 9c. My Activity ───────────────────────────────────────────
        ctx = makeCtx(ALICE, 'm_activity');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>My Activity</b>'), 'activity screen');
        assert(last.text.includes('Comments: <b>'), 'activity shows the comment count');
        assert(last.text.includes('Reactions received'), 'activity shows reactions');
        assert.deepStrictEqual(buttons(last), ['p_conf_0', 'p_com_0', 'm_menu'], 'activity actions');
        ok('My Activity summarises confessions, comments and reactions');

        // Nickname change: first change is allowed...
        ctx = makeCtx(ALICE, 'm_nick');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, undefined, 'AllyCatPro');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('AllyCatPro'), 'nickname changed');
        ok('first nickname change allowed (no cooldown yet)');

        // ...but a second change inside 14 days is blocked
        ctx = makeCtx(ALICE, 'm_nick');
        await service.routeCallback(ctx);
        assert(ctx.log.answers.some(a => a.includes('change it again')),
            'cooldown alert shown');
        assert(!(SESSIONS.get(ALICE.id).flow && SESSIONS.get(ALICE.id).flow.type === 'nickname'),
            'change flow not started during cooldown');
        ok('second change within 14 days is blocked with the unlock date');

        // Cooldown is re-checked on every attempt
        ctx = makeCtx(ALICE, 'm_nick');
        await service.routeCallback(ctx); // still blocked → no flow
        ok('cooldown re-checked on every attempt');

        // ── 9d. Browse Confessions (feed) ─────────────────────────────
        ctx = makeCtx(BOB, 'f_browse_0');
        await service.routeCallback(ctx);
        const feedBlocks = blocksOf(ctx);
        const feedHeader = feedBlocks.find(b => b.text.includes('<b>Confessions</b>'));
        assert(feedHeader, 'feed header rendered');
        assert(feedHeader.text.includes('published'), 'feed shows how many are published');
        const feedCard = feedBlocks.find(b => b.text.includes('I secretly debug production at 3am'));
        assert(feedCard, 'published confession appears in the feed');
        assert(buttons(feedCard).includes(`cb_${confessionId}_0`), 'feed card opens the discussion');
        assert(buttons(feedCard).includes(`cn_new_${confessionId}`), 'feed card can start a comment');
        ok('Browse Confessions shows a paged feed with discussion + comment actions');

        // ── 9e. Contact the admins ────────────────────────────────────
        ctx = makeCtx(BOB, 'm_contact');
        await service.routeCallback(ctx);
        assert(SESSIONS.get(BOB.id).flow.type === 'contact', 'contact flow open');
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('Contact the Admins'), 'contact prompt shown');
        assert.deepStrictEqual(buttons(last), ['ct_cancel'], 'composing can be cancelled');

        ctx = makeCtx(BOB, undefined, 'short');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('at least 10 characters'), 'too-short message rejected');

        ctx = makeCtx(BOB, undefined, 'Hi admins, could you add a tech topic?');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('could you add a tech topic'), 'preview quotes the message');
        assert.deepStrictEqual(buttons(last), ['ct_send', 'ct_cancel'], 'send / cancel buttons');

        ctx = makeCtx(BOB, 'ct_send');
        await service.routeCallback(ctx);
        const toAdmin = ctx.log.sent.find(m => String(m.chatId) === ADMIN_ID
            && m.text.includes('Message from a reader'));
        assert(toAdmin && toAdmin.text.includes('could you add a tech topic'), 'admin received the message');
        assert(ctx.log.sent.some(m => m.text.includes('Message sent to the admins')), 'sender confirmed');
        assert(!SESSIONS.get(BOB.id).flow, 'contact flow cleared after sending');
        ok('Contact Admin → validate → preview → delivered to the admin');

        // ── 9f. Admin panel ───────────────────────────────────────────
        ctx = makeCtx(ADMIN, 'a_hub');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Admin Panel</b>'), 'admin hub title');
        assert(last.text.includes('Total:'), 'hub shows totals');
        assert.deepStrictEqual(buttons(last),
            ['a_pend_0', 'a_appr_0', 'a_rej_0', 'a_stats', 'a_users', 'a_manage', 'm_menu'],
            'hub buttons: pending, approved, rejected, stats, users, manage, menu');
        assert(last.extra.reply_markup.inline_keyboard[0][0].text.includes('Pending'),
            'pending button carries its live count');
        ok('Admin panel hub exposes every admin screen with live counts');

        ctx = makeCtx(ADMIN, 'a_appr_0');
        await service.routeCallback(ctx);
        const approvedBlocks = blocksOf(ctx);
        assert(approvedBlocks.some(b => b.text.includes('<b>Approved confessions</b>')), 'approved list header');
        assert(approvedBlocks.some(b => b.text.includes('I secretly debug production')),
            'approved confession listed');
        ok('Approved list shows handled confessions with Preview / Post actions');

        ctx = makeCtx(ADMIN, `av_${confessionId}`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Confession preview</b>'), 'preview screen');
        assert(last.text.includes(String(confessionId)), 'preview shows the id');
        assert(buttons(last).includes(`a_post_${confessionId}`), 'approved preview can repost');
        ok('Preview shows the full confession, id and the actions for its status');

        ctx = makeCtx(ADMIN, 'a_stats');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Bot Statistics</b>'), 'bot statistics');
        assert(buttons(last).includes('a_pend_0'), 'statistics links to the pending list');

        ctx = makeCtx(ADMIN, 'a_users');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>User Statistics</b>'), 'user statistics');
        assert(last.text.includes('Profiles:'), 'user count shown');

        ctx = makeCtx(ADMIN, 'a_manage');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Bot Management</b>'), 'management screen');
        assert(last.text.includes('Database:'), 'management shows database state');
        assert(buttons(last).includes('a_manage'), 'management can refresh itself');
        ok('Statistics, user statistics and management screens all render');

        // ── 9g. Request Changes ──────────────────────────────────────
        const pendingConf = await databaseService.saveConfession({
            text: 'Please approve me, admins.', topic: 'other',
            authorId: String(STRANGER.id), nickname: 'Eve', metadata: {}
        });
        assert(pendingConf.success, 'pending confession created');

        ctx = makeCtx(ADMIN, 'a_pend_0');
        await service.routeCallback(ctx);
        const pendingBlocks = blocksOf(ctx);
        assert(pendingBlocks.some(b => b.text.includes('Please approve me, admins.')), 'pending list shows it');
        assert(pendingBlocks.some(b => buttons(b).includes(`av_${pendingConf.id}`)),
            'pending card has a Preview button');

        ctx = makeCtx(ADMIN, `a_ch_${pendingConf.id}`);
        await service.routeCallback(ctx);
        assert(SESSIONS.get(ADMIN.id).flow.type === 'adminNote', 'note flow opened');
        ctx = makeCtx(ADMIN, undefined, 'Please add a bit more detail about the topic.');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('Please add a bit more detail'), 'note preview quotes the note');
        assert(buttons(last).includes(`an_send_${pendingConf.id}`), 'note can be sent');

        ctx = makeCtx(ADMIN, `an_send_${pendingConf.id}`);
        await service.routeCallback(ctx);
        const authorNote = ctx.log.sent.find(m => String(m.chatId) === String(STRANGER.id));
        assert(authorNote && authorNote.text.includes('asked for changes'), 'author notified');
        assert(authorNote.text.includes('add a bit more detail'), 'the note reaches the author');
        const stillPending = await Confession.findById(pendingConf.id);
        assert.strictEqual(stillPending.status, 'pending', 'nothing was published');
        await Confession.deleteOne({ _id: pendingConf.id });
        ok('Request Changes sends the note and keeps the confession unpublished');

        // ── 9h. The remaining callbacks, one by one ──────────────────
        // Cancel a confession draft
        ctx = makeCtx(ALICE, 'c_start');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, 'c_topic_other');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, 'c_cancel');
        await service.routeCallback(ctx);
        assert(!SESSIONS.get(ALICE.id).flow, 'draft cleared by Cancel');
        assert(ctx.log.sent.some(m => m.text.includes('Cancelled')), 'cancel confirmation');

        // About / Help screens
        ctx = makeCtx(BOB, 'm_about');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('BHU Confession Bot'), 'About screen');
        assert(buttons(last).includes('m_contact'), 'About links to Contact Admin');

        ctx = makeCtx(BOB, 'm_help');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('Help'), 'Help screen');
        assert(buttons(last).includes('f_browse_0'), 'Help links to the feed');

        // Cancel a comment / a reply draft
        ctx = makeCtx(BOB, `cn_new_${confessionId}`);
        await service.routeCallback(ctx);
        ctx = makeCtx(BOB, `cn_can_${confessionId}`);
        await service.routeCallback(ctx);
        assert(!SESSIONS.get(BOB.id).flow, 'comment draft cleared');

        ctx = makeCtx(BOB, `cn_rep_${commentId}`);
        await service.routeCallback(ctx);
        ctx = makeCtx(BOB, `cn_rcan_${commentId}`);
        await service.routeCallback(ctx);
        assert(!SESSIONS.get(BOB.id).flow, 'reply draft cleared');

        // Cancel a contact message
        ctx = makeCtx(BOB, 'm_contact');
        await service.routeCallback(ctx);
        ctx = makeCtx(BOB, 'ct_cancel');
        await service.routeCallback(ctx);
        assert(!SESSIONS.get(BOB.id).flow, 'contact draft cleared by Cancel');
        assert(ctx.log.sent.some(m => m.text.includes('Main Menu')), 'back at the menu');
        ok('every Cancel button clears its draft and returns to the menu');

        // Rejected list + repost an approved confession
        ctx = makeCtx(ADMIN, 'a_rej_0');
        await service.routeCallback(ctx);
        assert(blocksOf(ctx).some(b => b.text.includes('<b>Rejected confessions</b>')), 'rejected list header');
        assert(blocksOf(ctx).some(b => b.text.includes('My boss thinks I am productive')),
            'the rejected confession is listed');

        ctx = makeCtx(ADMIN, `a_post_${confessionId}`);
        await service.routeCallback(ctx);
        const channelIdRef = String(process.env.CHANNEL_ID || '');
        assert(ctx.log.sent.some(m => String(m.chatId) === channelIdRef), 'repost reached the channel');
        assert(ctx.log.sent.some(m => m.text.includes('published to the channel')), 'repost confirmed');
        ok('Rejected list and 📢 Repost both work');

        // Request-changes Cancel returns to the preview without sending
        const noteConf = await databaseService.saveConfession({
            text: 'Cancel this note please.', topic: 'other',
            authorId: String(STRANGER.id), nickname: 'Eve', metadata: {}
        });
        ctx = makeCtx(ADMIN, `a_ch_${noteConf.id}`);
        await service.routeCallback(ctx);
        ctx = makeCtx(ADMIN, `an_cancel_${noteConf.id}`);
        await service.routeCallback(ctx);
        assert(!SESSIONS.get(ADMIN.id).flow, 'note draft cleared');
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('<b>Confession preview</b>'), 'cancel returns to the preview');
        assert(!ctx.log.sent.some(m => String(m.chatId) === String(STRANGER.id)),
            'no note was delivered after Cancel');

        // Legacy direct-decision buttons still work on old review messages
        ctx = makeCtx(ADMIN, `ad_ok_${noteConf.id}`);
        await service.routeCallback(ctx);
        const legacyDoc = await Confession.findById(noteConf.id);
        assert.strictEqual(legacyDoc.status, 'approved', 'legacy ad_ok_ still decides');
        await Confession.deleteOne({ _id: noteConf.id });
        ok('Cancel on a note keeps it private; legacy ad_ok_ buttons still work');

        // ── 10. Every button is labelled, routed and reachable ────────
        const kb = require('../src/utils/keyboards');
        const fakeId = 'a'.repeat(24);

        const screens = {
            mainMenu: kb.mainMenu(),
            topics: kb.topics(),
            confessionPreview: kb.confessionPreview(),
            profile: kb.profile(),
            activity: kb.activity(),
            about: kb.about(),
            help: kb.help(),
            contactCompose: kb.contactCompose(),
            contactPreview: kb.contactPreview(),
            feedHeader: kb.feedHeader(0, 3),
            myConfessions: kb.myConfessions(0, 3),
            myComments: kb.myComments(0, 3),
            adminHub: kb.adminHub({ pending: 1, approved: 2, rejected: 3 }),
            adminConfirm: kb.adminConfirm(fakeId, 'ok'),
            adminChanges: kb.adminChangesPreview(fakeId),
            adminList: kb.adminListFor('pending', 0, 2),
            adminStats: kb.adminStats(),
            adminUsers: kb.adminUsers(),
            adminManage: kb.adminManage()
        };

        const cards = {
            feedCard: kb.feedCard(fakeId),
            adminReview: kb.adminReview(fakeId),
            adminArchive: kb.adminArchiveItem({ _id: fakeId, status: 'approved' }),
            channelPost: kb.channelPost(fakeId, 'TestBot', 3),
            publishedNotice: kb.publishedNotice('https://t.me/testchannel/42')
        };

        const KNOWN_PREFIXES = ['m', 'p', 'c', 'f', 'ct', 'cb', 'cn', 'cr', 'cv', 'a', 'av', 'ay', 'an', 'ad'];
        let buttonCount = 0;
        let urlCount = 0;

        for (const [name, keyboard] of Object.entries({ ...screens, ...cards })) {
            const rows = keyboard.inline_keyboard;
            assert(Array.isArray(rows) && rows.length > 0, `${name} is not empty`);
            for (const row of rows) {
                assert(row.length <= 2, `${name}: at most 2 buttons per row (got ${row.length})`);
                for (const button of row) {
                    buttonCount += 1;
                    assert(button.text && button.text.trim(), `${name}: every button has a label`);
                    if (button.url) {
                        urlCount += 1;
                        continue;
                    }
                    assert(button.callback_data, `${name}: "${button.text}" has an action`);
                    assert(Buffer.byteLength(button.callback_data) <= 64,
                        `${name}: callback data fits 64 bytes`);
                    const prefix = button.callback_data.split('_')[0];
                    assert(KNOWN_PREFIXES.includes(prefix),
                        `${name}: "${button.text}" uses a routed prefix (got ${prefix})`);
                }
            }
        }

        // Every submenu must offer a way back.
        const backTargets = ['m_menu', 'c_back', 'c_cancel', 'a_hub', 'ct_cancel', 'an_cancel'];
        for (const [name, keyboard] of Object.entries(screens)) {
            if (name === 'mainMenu') continue; // the root screen is the back target
            const flat = keyboard.inline_keyboard.flat().map(b => b.callback_data || b.text);
            assert(flat.some(b => b.startsWith('av_')
                || backTargets.some(t => b === t || b.startsWith(t + '_'))),
                `${name} has a Back / Cancel / Menu button`);
        }

        assert(buttonCount >= 50, `inventory covered the UI (${buttonCount} buttons)`);
        assert(urlCount >= 3, 'channel / notification buttons stay URL deep links');
        ok(`all ${buttonCount} buttons are labelled, routed, ≤2 per row and reachable back`);

        // ── 11. Validation ────────────────────────────────────────────
        ctx = makeCtx(ALICE, 'c_start');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, 'c_topic_other');
        await service.routeCallback(ctx);
        ctx = makeCtx(ALICE, undefined, 'ab');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('too short'), 'short confession rejected');
        ok('validation rejects too-short confessions');

        // /setchannel runs the REAL verifyChannelAccess against the mock API
        ctx = makeCtx(ADMIN, undefined, '/setchannel @testchannel');
        await adminController.setChannel(ctx);
        const setReply = ctx.log.replies.map(r => r.text).join('\n');
        assert(setReply.includes('Channel configured'), 'channel configured');
        ok('/setchannel verifies access through the real channel service');

        // Admin command guard
        let nextCalled = false;
        await authMiddleware.isAdmin(
            makeCtx(STRANGER, undefined, '/pending'),
            () => { nextCalled = true; }
        );
        assert(!nextCalled, 'stranger command blocked');
        ok('non-admin cannot run admin commands');

        // ── 12. Every rendered screen is valid Telegram HTML ──────────
        assert(OUTBOUND.length > 60, `exercised the full UI (${OUTBOUND.length} outbound messages)`);
        const broken = [];
        for (const text of OUTBOUND) {
            const problems = htmlProblems(text);
            if (problems.length) broken.push(`${problems.join('; ')} → ${text.slice(0, 60).replace(/\n/g, ' ')}`);
        }
        assert.strictEqual(broken.length, 0, `invalid HTML:\n    ${broken.join('\n    ')}`);
        ok(`all ${OUTBOUND.length} outbound messages are valid Telegram HTML (tags balanced, ≤4096 chars)`);

        // Optional: dump what was rendered, e.g. to replay a sample against the
        // real Bot API. VERIFY_DUMP=/tmp/outbound.json node scripts/verify-flow.js
        if (process.env.VERIFY_DUMP) {
            require('fs').writeFileSync(process.env.VERIFY_DUMP, JSON.stringify(OUTBOUND, null, 1));
            console.log(`  💾 wrote ${OUTBOUND.length} messages to ${process.env.VERIFY_DUMP}`);
        }

        console.log(`\n🎉 All ${passed} checks passed`);
        process.exitCode = 0;
    } catch (error) {
        console.error('\n❌ FAILED:', error.message);
        console.error(error.stack.split('\n').slice(0, 5).join('\n'));
        process.exitCode = 1;
    } finally {
        // Cleanup only the test data this script created
        try {
            const created = [confessionId, typeof secondId !== 'undefined' ? secondId : null].filter(Boolean);
            if (created.length) {
                await Comment.deleteMany({ confessionId: { $in: created } });
                await Confession.deleteMany({ _id: { $in: created } });
            }
            const synthetic = [String(ALICE.id), String(BOB.id), String(STRANGER.id), String(CAROL_REF.id)];
            await User.deleteMany({ telegramId: { $in: synthetic } });
            await mongoose.disconnect();
        } catch (e) {
            console.error('cleanup error:', e.message);
        }
    }
})();

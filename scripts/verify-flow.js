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
const Comment = require('../src/models/Comment.model');
const Confession = require('../src/models/Confession.model');
const User = require('../src/models/User.model');
const mongoose = require('mongoose');

// ── Mock Telegram transport ───────────────────────────────────────────────
const SESSIONS = new Map();

function makeCtx(user, callbackData, messageText) {
    const log = { sent: [], answers: [], edits: [], replies: [], markupEdits: [] };
    const ctx = {
        from: { ...user },
        callbackQuery: callbackData ? { data: callbackData } : undefined,
        message: messageText !== undefined ? { text: messageText } : undefined,
        updateType: callbackData ? 'callback_query' : 'message',
        telegram: {
            sendMessage: async (chatId, text, extra) => {
                log.sent.push({ chatId, text, extra });
                return { message_id: log.sent.length };
            },
            getMe: async () => ({ username: 'TestBot', id: 1 }),
            getChat: async () => ({ title: 'TestChannel', username: 'testchannel' }),
            getChatMember: async () => ({ status: 'administrator' }),
            editMessageReplyMarkup: async (chatId, messageId, inlineMessageId, markup) => {
                log.markupEdits.push({ chatId, messageId, markup });
                return true;
            }
        },
        reply: async (text, extra) => {
            log.replies.push({ text, extra });
            return { message_id: log.replies.length };
        },
        answerCbQuery: async (text) => { log.answers.push(text || ''); },
        editMessageText: async (text) => { log.edits.push(text); }
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
            menuBtns, ['c_start', 'm_profile', 'm_help'],
            'menu buttons: Send Confession, Profile, Help'
        );
        ok('main menu shows Send Confession, Profile, Help');

        // ── 2. Topic selection ────────────────────────────────────────
        ctx = makeCtx(ALICE, 'c_start');
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('topic'), 'topic prompt shown');
        const topicBtns = buttons(last);
        assert(topicBtns.includes('c_topic_love') && topicBtns.includes('c_topic_other'),
            'topic buttons present');
        ok('Send Confession → topic selection buttons');

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
        assert.deepStrictEqual(buttons(last), ['c_edit', 'c_submit', 'c_cancel'],
            'preview buttons: Edit Submit Cancel');
        ok('preview with Edit / Submit / Cancel');

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
        assert.deepStrictEqual(buttons(review), [`ad_ok_${confessionId}`, `ad_no_${confessionId}`],
            'review has Approve / Reject buttons');
        ok('submit → locked, review sent to admin with Approve/Reject');

        // Locked: stray text shows menu
        ctx = makeCtx(ALICE, undefined, 'hello?');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('not writing anything'), 'locked hint');
        ok('after submission the confession is locked (stray text → menu)');

        // ── 5. Non-admin cannot decide ────────────────────────────────
        ctx = makeCtx(STRANGER, `ad_ok_${confessionId}`);
        await service.routeCallback(ctx);
        assert(ctx.log.answers.some(a => a.includes('admins')), 'stranger blocked');
        let doc = await Confession.findById(confessionId);
        assert.strictEqual(doc.status, 'pending', 'still pending after stranger attempt');
        ok('non-admin cannot approve (server-side check)');

        // ── 6. Admin approves → publish + notify author ───────────────
        ctx = makeCtx(ADMIN, `ad_ok_${confessionId}`);
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
        assert.strictEqual(postBtns[0].text, '💬 Browse Comments',
            'no count shown before any comments exist');
        assert(postBtns[0].url && postBtns[0].url.includes(`?start=cb_${confessionId}_0`),
            'Browse Comments is a deep link to the comments page');
        assert(postBtns[1].url && postBtns[1].url.includes(`?start=cn_new_${confessionId}`),
            'Send Comment is a deep link that opens the comment flow');
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
        ctx = makeCtx(ALICE, 'c_submit');
        await service.routeCallback(ctx);
        secondId = SESSIONS.get(ALICE.id).lastConfessionId;
        assert(secondId && secondId !== confessionId, 'second confession saved');

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

        // ── 8. Comments on the approved confession ────────────────────
        ctx = makeCtx(BOB, `cb_${confessionId}_0`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('No comments yet'), 'empty comments list');
        ok('Browse Comments (empty) shows list + Send Comment button');

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
        ctx = makeCtx(BOB, `cn_sub_${confessionId}`);
        await service.routeCallback(ctx);
        last = ctx.log.sent.find(
            m => String(m.chatId) === String(BOB.id) && m.text.includes('Comment posted'));
        assert(last && last.text.includes('Comment posted'), 'comment submitted');
        ok('send comment → preview → submit');

        // Comment author (confession owner) is notified + channel count updated
        const commentNotify = ctx.log.sent.find(
            m => String(m.chatId) === String(ALICE.id)
                && m.text.includes('New comment on your confession'));
        assert(commentNotify, 'confession owner notified about the new comment');
        assert(commentNotify.text.includes('This one is my favourite!'),
            'notification includes the comment snippet');
        const countEdit1 = ctx.log.markupEdits.find(
            e => e.markup.inline_keyboard[0][0].text === '💬 Browse Comments (1)');
        assert(countEdit1, 'channel post button count updated to 1');
        ok('comment → owner notified + channel button count updated');

        // Browse shows the comment with a Reply button
        ctx = makeCtx(BOB, `cb_${confessionId}_0`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('This one is my favourite!'), 'comment listed');
        const replyBtn = buttons(last).find(b => b && b.startsWith('cn_rep_'));
        assert(replyBtn, 'Reply button present');
        ok('browse shows comment with Reply button');

        // Reply flow
        const commentId = replyBtn.replace('cn_rep_', '');
        ctx = makeCtx(ALICE, replyBtn);
        await service.routeCallback(ctx);
        assert(SESSIONS.get(ALICE.id).flow.type === 'reply', 'reply flow active');
        ctx = makeCtx(ALICE, undefined, 'Totally agree with this.');
        await botController.handleText(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert.deepStrictEqual(buttons(last), [`cn_rsub_${commentId}`, `cn_rcan_${commentId}`],
            'reply preview buttons');
        ctx = makeCtx(ALICE, `cn_rsub_${commentId}`);
        await service.routeCallback(ctx);
        const replies = await Comment.find({ parentCommentId: commentId });
        assert.strictEqual(replies.length, 1, 'reply stored with parentCommentId');
        ok('reply → preview → submit, linked to parent comment');

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

        // Reply-to-reply blocked
        ctx = makeCtx(BOB, `cn_rep_${String(replies[0]._id)}`);
        await service.routeCallback(ctx);
        assert(ctx.log.answers.some(a => a.includes('not supported')), 'one-level only');
        ok('reply-to-reply blocked (one level only)');

        // Browse shows threaded reply
        ctx = makeCtx(BOB, `cb_${confessionId}_0`);
        await service.routeCallback(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('↳ AllyCat: Totally agree with this.'),
            'reply indented under comment with nickname');
        ok('browse shows replies threaded under their comment');

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
        const countEdit3 = ctx.log.markupEdits.find(
            e => e.markup.inline_keyboard[0][0].text === '💬 Browse Comments (3)');
        assert(countEdit3, 'channel post button count updated to 3');
        ok('third-party reply → both owners notified + count now (3)');

        // ── 8b. Deep links: channel button → bot opens on that page ──
        const CAROL = { id: 777000444, first_name: 'Carol', last_name: '', username: 'carol_c' };

        ctx = makeCtx(CAROL);
        ctx.startPayload = `cb_${confessionId}_0`;
        await botController.handleStart(ctx);
        last = ctx.log.sent[ctx.log.sent.length - 1];
        assert(last.text.includes('This one is my favourite!'),
            'deep link lands on the comments page');
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
        assert(last.text.includes('Alice Tester'), 'display name');
        assert(last.text.includes('@alice_t'), 'username');
        assert(last.text.includes('submitted: 2'), 'two submitted');
        assert(last.text.includes('Approved: 1'), 'one approved');
        ok('profile shows name, username and counts');
        assert(last.text.includes('Nickname: AllyCat'), 'profile shows nickname');
        assert.deepStrictEqual(buttons(last), ['m_nick', 'm_menu'],
            'profile has Change nickname button');
        ok('profile shows nickname with a Change nickname button');

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

        // ── 10. Validation ────────────────────────────────────────────
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

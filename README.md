# BhuConfession — Anonymous Confession Telegram Bot

A Telegram bot where users pick a topic, write a confession, preview/edit it, and submit it for admin review. Approved confessions are published to a channel with **Browse Comments** and **Send Comment** buttons; all comments and one-level replies happen inside the bot.

**Stack:** Node.js · [Telegraf](https://telegraf.js.org) · Express 5 · Mongoose (MongoDB Atlas) · Winston · Helmet

## User Flow

1. `/start` → the bot asks for a **nickname** (first time only), then shows the main menu: **Send Confession · Profile · Help**
2. **Send Confession** → pick a topic (❤️ Love, 🤝 Friendship, 👨‍👩‍👧 Family, 🎓 School/Work, 💬 Other)
3. Write the confession → **preview** with **Edit / Submit / Cancel**
4. Submit → the confession is **locked** and sent to the admin review chat (`pending`)
5. Admin taps **Approve** or **Reject** (only configured admin IDs work, checked server-side)
6. The author gets a **private notification** of the decision (only if they pressed `/start`); on approval it carries a **📢 View on Channel** button that links straight to their published post (`https://t.me/<channel>/<message_id>`). Channels without a public `@username` get no button rather than a dead link
7. On approval the confession is posted to the channel showing the author's **nickname** (`Confession from <nickname>`, or `Anonymous Confession` if none was set) with two buttons:
   - **💬 Browse Comments (N)** — shows the live comment count, which is refreshed on the channel post every time a comment or reply arrives; deep link that **opens the bot directly on the comments page** (paginated; each top-level comment has a **Reply** button)
   - **✏️ Send Comment** — deep link that opens the bot with the comment prompt ready: write → preview → submit; replies are one level deep

   The channel buttons are `t.me/<bot>?start=…` deep links, so one tap opens the bot conversation on the right page even if the user has never started the bot before.

### Comment notifications

- New comment → the **confession owner** is notified privately with the comment snippet
- New reply → the **confession owner** *and* the **owner of the replied-to comment** are notified
- You are never notified about your own actions; users who never started the bot are skipped gracefully

### Nicknames

- Asked once on the first `/start`; shown instead of "Anonymous" on published confessions and in comment lists (`nickname: text`)
- Changeable from **Profile → Change nickname**, limited to **one change every 14 days** (the first set is free so a typo can be fixed immediately)
- Stored as a snapshot on each confession/comment — later nickname changes don't rewrite already-published posts
- Your real name and username are never published

## Rules (v1)

- A confession is never posted publicly before admin approval
- Editing is only possible **before** submitting; after that it's locked
- Only the original author receives the decision notification
- Admins never see who wrote a confession (`authorId` is stored separately for notifications/profile and is never displayed or published)
- **Nothing except confessions is ever posted to the channel** — comments, replies and notifications stay in the bot
- All callback (button) actions are validated and admin permissions re-checked server side
- Deleted channel posts or undeliverable notifications are logged, never crash the bot

## Project Structure

```
server.js                       # Entry point: Express + bot bootstrap, shutdown handlers
scripts/verify-flow.js          # End-to-end flow test (mocked Telegram) - see Testing
src/
├── config/database.js          # Mongoose connection (pool, retries, events)
├── controllers/
│   ├── bot.controller.js       # Menu, confession flow, comments, profile
│   └── admin.controller.js     # Review buttons, notifications, publishing
├── middleware/auth.middleware.js   # Admin list check + rate limiters
├── models/
│   ├── Confession.model.js     # Confession (topic, authorId, nickname, status)
│   ├── Comment.model.js        # Comments + one-level replies
│   └── User.model.js           # Nickname + 14-day change cooldown
├── services/
│   ├── telegram.service.js     # Command registration + central callback router
│   ├── database.service.js     # Confession/comment CRUD + stats
│   └── channel.services.js     # Channel formatting & posting (with buttons)
└── utils/                      # constants, keyboards, logger, validator
```

## Getting Started

### Prerequisites

- Node.js 18+
- A MongoDB database (e.g. free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your numeric Telegram user ID (e.g. from [@userinfobot](https://t.me/userinfobot))
- The bot must be an **admin of your channel** with permission to post

### Installation

```bash
npm install
cp .env.example .env   # then fill in your values
```

### Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No (default `3000`) | Port for the Express health/stats server |
| `NODE_ENV` | No | `production` enables `info` log level and hides error details from users |
| `BOT_TOKEN` | **Yes** | Telegram bot token from @BotFather |
| `MONGODB_URI` | **Yes** | MongoDB connection string (URL-encode special chars like `@` → `%40`) |
| `ADMIN_ID` | **Yes** (for admin) | Admin Telegram ID(s), comma-separated for multiple admins |
| `CHANNEL_ID` | No | Default channel (`@username` or `-100…` ID). Can also be set with `/setchannel` |
| `ADMIN_API_KEY` | No | Shared secret for HTTP endpoints guarded by `x-admin-key` |
| `TRUST_PROXY` | No | Proxy hops to trust when reading the client IP. Auto `1` on Render; set `false` to disable |
| `DB_PING_TIMEOUT_MS` | No (default `4000`) | How long `/health` waits for the MongoDB ping before reporting `timeout` |
| `KEEPALIVE` | No (default off) | `true` pings the service's own public URL every 10 min so a Render **Free** instance never hits the 15-minute idle spin-down |
| `KEEPALIVE_INTERVAL_MS` | No (default `600000`) | Keep-alive period; must stay under 15 min to be useful |

The bot refuses to start if `BOT_TOKEN` or `MONGODB_URI` is missing.

### Running

```bash
npm run dev    # development (nodemon)
npm start      # production
```

## Bot Commands

**Public:** `/start` · `/menu` · `/help` · `/status` · `/privacy` · `/about`

**Admin** (only configured `ADMIN_ID`s):

| Command | Description |
| --- | --- |
| `/admin` | Admin panel: pending / approved / rejected / stats / users / management |
| `/pending` | Review pending confessions as messages with action buttons |
| `/stats` | Quick statistics |
| `/setchannel <@channel>` | Set/verify the publishing channel |
| `/post <id>` | Retry publishing an approved confession |
| `/adminhelp` | Admin command reference |

Decisions are also reachable from every review message. Approve/Reject always ask for confirmation first; nothing is executed on the first tap.

## Screens

One design system everywhere: one emoji per action, at most two buttons per row, primary action on its own row, and `🔙 Back` / `🏠 Main Menu` on every screen.

```text
🏠 Main Menu
[✍️ Send a Confession]
[💬 Browse Confessions] [👤 My Profile]
[📊 My Activity]        [ℹ️ About]
[📩 Contact Admin]
```

| Screen | Actions |
| --- | --- |
| Confession draft | topic (2 per row, **🔙 Back**) → preview: `✏️ Edit Confession`, `🗑️ Cancel`, `✅ Submit Confession` |
| `💬 Browse Confessions` | paged feed (3 per page); each card: `💬 Open Discussion`, `✍️ Send Comment`; header: `✍️ Send a Confession`, `🏠 Main Menu` |
| `👤 My Profile` | `✏️ Change Nickname`; `📊 My Confessions`; `💬 My Comments`; `🔙 Back to Menu` |
| `📊 My Activity` | confessions by status, comments, replies, reactions received; links to both personal lists |
| `📊 My Confessions` | paged cards with status + discussion link; `🔙 Back` / `🏠 Main Menu` |
| `💬 My Comments` | paged cards quoting each comment + the confession it belongs to; `🔙 Back` / `🏠 Main Menu` |
| `📩 Contact Admin` | validate (10–1000 chars) → preview → `📤 Send to Admins` / `🗑️ Cancel`; delivered to every `ADMIN_ID` |
| Discussion | cards with reactions, Reply, View/Hide replies, pagination (see below) |
| 🛠️ Admin Panel | `📥 Pending · n`, `✅ Approved · n`, `❌ Rejected · n`, `📊 Bot Statistics`, `👥 User Statistics`, `⚙️ Bot Management`, `🏠 Main Menu` |
| Admin lists | paged cards (3 per page); pending: `👁️ Preview`, `✏️ Request Changes`, `✅ Approve`, `❌ Reject`; approved/rejected: `👁️ Preview`, `📢 Post / Repost` |
| Decision | `✅ Approve` → confirmation (`✅ Yes, Approve` / `🔙 Back`) → published + author notified |
| Request changes | admin types a 10–500 char note → preview → `📤 Send Note` / `🗑️ Cancel`; the confession stays unpublished |
| Bot Management | live bot handle, channel, database state, uptime, keep-alive; `🔄 Refresh Status`, `📊 Bot Statistics`, `🔙 Admin Panel` |

The profile screen deliberately shows the **nickname**, not the Telegram name, so nothing on screen can leak an author's identity.

## HTTP Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /health` | Uptime, config status, DB health, and **bot status** (`bot.state`, `bot.username`, `bot.polling`, `bot.lastUpdateAt`, `bot.lastError`) |
| `GET /stats` | Confession counts by status |

## Confession Lifecycle

```
draft → preview (edit/cancel) → submitted (locked, pending)
                                      ├─ approved  → posted to channel (+ comment buttons)
                                      ├─ rejected  → author notified, nothing published
                                      └─ changes requested → note sent, stays unpublished
             every decision → private notification to the author
```

## Comments & Discussions

Comments never touch the channel — the whole discussion lives in the bot's private chat, drawn as separate blocks:

```text
💬 Discussion · page 1/2          ← header: confession excerpt, count,
   "I secretly debug production…"    Prev/Next, Send Comment, Menu
📊 4 comments

💬 #1 · AllyCat · 2h ago          ← one card per top-level comment
  I secretly debug production at 3am. No regrets.
  ↳ 2 replies · tap to open
  [❤️ 2 ✓] [😂] [🔥 1] [👍]         ← reactions, tap to toggle, ✓ = yours
  [↩️ Reply] [🔽 2 replies]         ← reply / expand

💬 #2 · Bobby · 1h ago
  I have been pretending to understand the timetable for two years.
  [❤️] [😂] [🔥] [👍]
  [↩️ Reply]
```

Expanding a thread edits that same card, nesting its replies (author + timestamp each) and giving every reply its own `↩️ Reply · <name>` button.

- **One level of nesting, by construction.** Tapping Reply on a *reply* still stores `parentCommentId` as the thread's top-level comment, and records the comment that was actually addressed in `replyToCommentId`. Depth can never grow, while the right person still gets notified.
- **Context before typing.** The comment being answered is quoted (with its author) when the reply flow opens *and* above the draft preview.
- **The target is re-verified on submit.** It must still exist, belong to the same confession and still be top-level — otherwise the draft is dropped with a message instead of being saved against the wrong comment.
- **One identity per discussion.** Every person resolves to a single name for the whole discussion (current nickname, else a stable `Anon #N`), so a rename never leaves one person under two names.
- **In-place paging.** 4 cards per page; Prev/Next edits those messages and deletes surplus blocks rather than posting new ones (which is also why a card is re-rendered in place when you react or expand it).
- **Size limits.** 4 replies shown per expanded thread (most recent, `+N earlier` for the rest), 700 characters of a comment and 320 per reply per card — keeping every card under Telegram's 4096-character message cap.
- **Reactions** (`❤️ 😂 🔥 👍`) store the Telegram ids that tapped them, become counts server-side, and toggle off on a second tap.

### Callback scheme

Telegram caps callback data at 64 bytes and every button must be routed, so the prefixes are:

| Prefix | Meaning |
| --- | --- |
| `m_*` | menu, help, about, profile, nickname, activity, contact |
| `p_conf_<page>` / `p_com_<page>` | my confessions / my comments |
| `c_*` | confession flow: start, topic, edit, submit, cancel, back |
| `f_browse_<page>` | confession feed |
| `ct_send` / `ct_cancel` | contact-the-admins draft |
| `cb_<cid>_<page>`, `cn_*`, `cr_*`, `cv_*` | discussion (page, write, react, expand) |
| `a_*` | admin panel: hub, lists, stats, users, manage, ok/no/ch/post |
| `av_<id>` | admin preview |
| `ay_ok|no_<id>` | admin: confirmed decision |
| `an_send|cancel_<id>` | admin: request-changes note |
| `ad_ok|no_<id>` | legacy direct decisions (old review messages keep working) |

`node scripts/verify-flow.js` asserts that every button the bot builds has a label, a routed prefix and a way back.

## Testing

```bash
node scripts/verify-flow.js
```

Drives the **real** controllers with a mocked Telegram transport: nickname onboarding and cooldown, menu, topics, preview/edit/submit, locking, admin approve/reject with permission checks, decision + comment/reply notifications, live comment counts on the channel button, channel publishing with nickname + deep-link buttons, the approval DM's link to the channel post, the discussion UI — cards, reaction toggling per user, reply context, nesting, expand/collapse, cross-discussion reply rejection, pagination + HTML escaping, identity consistency and pre-redesign comments — the profile/activity/personal-list screens, the confession feed, contact-the-admins delivery, the whole admin panel (hub, lists, preview, confirmation, request-changes, stats, users, management), expired-callback recovery, the double-tap guard and a button inventory, and a check that every outbound message is valid Telegram HTML (balanced tags, ≤4096 chars): **67 assertions**, then cleans up its own test data.

## Data & Privacy

Confessions store: text, topic, status, timestamps, metadata, admin action details, the author's Telegram ID **in a separate field** (used only for the decision notification and profile counts — stripped from every public/admin view), and the public **nickname snapshot**. Comments store the same, plus `parentCommentId` / `replyToCommentId` and a `reactions` map of `{ heart, laugh, fire, like }` holding the Telegram ids that tapped — those arrays are only ever turned into counts before anything is rendered. The `users` collection holds only `telegramId`, `nickname`, and the last-change timestamp.

## Logging

Winston writes to the console plus `logs/combined.log` and `logs/error.log` (5 MB × 5 files each). The `logs/` directory is created automatically and is gitignored.

## Deploying to Render

The repo ships a [render.yaml](render.yaml) blueprint, so Render can create the service for you.

1. Push the repo to GitHub (do **not** commit `.env` — it is gitignored).
2. On [Render](https://render.com): **New + → Blueprint**, connect the repo. Render reads `render.yaml` and proposes a **Web Service** with build `npm ci` and start `npm start`.
   - Manual alternative: **New + → Web Service**, Runtime **Node**, Build Command `npm ci`, Start Command `npm start`, Health Check Path `/health`.
3. Add the environment variables in **Environment** (the blueprint marks them `sync: false`, so you fill them in): `BOT_TOKEN`, `MONGODB_URI`, `ADMIN_ID`, and optionally `CHANNEL_ID` / `ADMIN_API_KEY` / `NODE_ENV=production`. `PORT` is injected by Render — don't set it.
4. In **MongoDB Atlas → Network Access**, allow Render's outbound IP ranges (Dashboard → your service → **Connect → Outbound**) — or `0.0.0.0/0` for a quick test. Atlas rejects unlisted sources and the bot exits on a failed connect.
5. Deploy, then open `https://<service>.onrender.com/health` — expect `"status":"OK"` with `botToken`, `adminId` and `database` configured. Logs are in the Dashboard's **Logs** tab.

### Things that bite on Render

- **Free instances sleep, and that stops the bot.** Render spins a Free Web Service down after **15 minutes without inbound HTTP traffic**; outbound Telegram long-polling does not count as traffic, so the process is stopped and the bot goes silent until someone opens the URL again (then it takes ~1 min to wake). See [the diagnosis below](#bot-stopped-answering-the-symptom-this-readme-keeps-describing) for the three ways out.
- **Keep it at exactly one instance.** Two running copies poll Telegram at once and errors with `409 Conflict`; do not enable autoscaling.
- **The filesystem is ephemeral.** `logs/*.log` and anything else written to disk disappear on redeploy/restart — read logs in the Render dashboard (7-day retention on Hobby) or add a persistent disk.
- **The server binds `0.0.0.0:PORT`** (Render's default `PORT` is `10000`); `HOST` can override the interface but is not needed. The startup log prints the real bind address and uses `RENDER_EXTERNAL_URL` for the health/stats URLs, so it never claims `localhost` on a deployed instance.
- **`trust proxy` turns on automatically on Render (`1` hop).** Render terminates TLS and forwards the client IP in `X-Forwarded-For`; without it express-rate-limit logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` and every visitor shares one bucket keyed on the proxy (so `/health` probes can `429`, which Render reads as an unhealthy service). Locally it stays off, so a forged header can't dodge the limiter. Override with `TRUST_PROXY=<hops|true|false>`.
- **`/health` never hangs.** The MongoDB ping is bounded by `DB_PING_TIMEOUT_MS` and reports `"dbStatus":"timeout"` instead of stalling past Render's probe timeout. `SIGTERM` stops polling and closes the HTTP server (including keep-alive sockets) so deploys don't wait for the grace period to expire.
- **Set the bot's channel admin rights** before approving anything, and use `/setchannel` if `CHANNEL_ID` is not set — otherwise approvals post nothing and log a failure.

### Bot stopped answering? The symptom this README keeps describing

A bot that replies right after deploying and is silent the next morning is almost always one of three things, in this order:

1. **The Free instance spun down** (15 min of no inbound HTTP). Open `https://<service>.onrender.com/health`; if it takes ~1 min and then answers, that was it. Logs show a fresh `Starting Confession Bot...` with no error.
2. **`409 Conflict: terminated by other getUpdates request`** — a second process polls the same `BOT_TOKEN` (a local `npm start`, a leftover deploy, or a second Render instance). Telegram allows one consumer per token; the loser keeps failing. Stop the other process. The service now logs which one it hit and retries with backoff (2s → 4s → … → 60s, 5 attempts) instead of exiting, so a deploy overlap heals itself.
3. **`401 Unauthorized`** — the token was revoked/regenerated in @BotFather. This is fatal and the log says so; update `BOT_TOKEN` in the dashboard.

`/health` answers 1 and 2 without opening the logs:

```json
"bot": { "state": "running", "username": "@BhuConfessionbot", "polling": true, "secondsSinceLastUpdate": 42, "lastError": null }
```

`bot.state` is `starting` (before the first poll), `running`, `stopped`, or `not-polling` (a `lastError` explains why). `polling: false` during normal operation means the bot is not consuming messages. `lastError` is kept after a recovery so you can still see why polling dropped and when.

**Keeping a Free instance awake.** Set `KEEPALIVE=true`; the process then GETs its own `RENDER_EXTERNAL_URL/health` every 10 minutes, those requests reach the app through Render's proxy, and the idle timer never expires. It needs `RENDER_EXTERNAL_URL` (Render injects it) and logs `🔁 Keep-alive enabled` on boot. This is a workaround for a plan limit: Render's docs describe paid instance types as the supported way to run continuously, and an external uptime monitor (any service that fetches the URL every few minutes) achieves the same thing without touching the code. If you would rather not do either, upgrade the instance — a paid plan does not spin down.

## License

ISC

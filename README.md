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

The bot refuses to start if `BOT_TOKEN` or `MONGODB_URI` is missing.

### Running

```bash
npm run dev    # development (nodemon)
npm start      # production
```

## Bot Commands

**Public:** `/start` (main menu) · `/help` · `/status` · `/privacy` · `/about`

**Admin** (only configured `ADMIN_ID`s):

| Command | Description |
| --- | --- |
| `/pending` | Review pending confessions with Approve/Reject buttons |
| `/stats` | Statistics |
| `/setchannel <@channel>` | Set/verify the publishing channel |
| `/post <id>` | Retry publishing an approved confession |
| `/adminhelp` | Admin command reference |

Approve/reject also work directly from the buttons on each review message.

## HTTP Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /health` | Uptime, config status, DB health |
| `GET /stats` | Confession counts by status |

## Confession Lifecycle

```
draft → preview (edit/cancel) → submitted (locked, pending)
                                      ├─ approved → posted to channel (+ comment buttons)
                                      └─ rejected
             both decisions → private notification to the author
```

## Testing

```bash
node scripts/verify-flow.js
```

Drives the **real** controllers with a mocked Telegram transport: nickname onboarding and cooldown, menu, topics, preview/edit/submit, locking, admin approve/reject with permission checks, decision + comment/reply notifications, live comment counts on the channel button, channel publishing with nickname + deep-link buttons, the approval DM's link to the channel post, comments, threaded replies, and profile — 37 assertions, then cleans up its own test data.

## Data & Privacy

Confessions store: text, topic, status, timestamps, metadata, admin action details, the author's Telegram ID **in a separate field** (used only for the decision notification and profile counts — stripped from every public/admin view), and the public **nickname snapshot**. Comments store the same. The `users` collection holds only `telegramId`, `nickname`, and the last-change timestamp.

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

- **Use a paid instance for an always-on bot.** Free Web Services **spin down after 15 minutes without inbound HTTP traffic**; outbound Telegram polling does not count, so the bot silently stops answering. Background Workers stay alive but have no HTTP port (no `/health`), and are not offered on the free plan.
- **Keep it at exactly one instance.** Two running copies poll Telegram at once and errors with `409 Conflict`; do not enable autoscaling.
- **The filesystem is ephemeral.** `logs/*.log` and anything else written to disk disappear on redeploy/restart — read logs in the Render dashboard (7-day retention on Hobby) or add a persistent disk.
- **The server binds `0.0.0.0:PORT`** (Render's default `PORT` is `10000`); `HOST` can override the interface but is not needed.
- **Set the bot's channel admin rights** before approving anything, and use `/setchannel` if `CHANNEL_ID` is not set — otherwise approvals post nothing and log a failure.

## License

ISC

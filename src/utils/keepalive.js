// src/utils/keepalive.js
//
// Render's Free plan spins a web service down after 15 minutes without any
// *inbound* traffic. A Telegram long-poll loop only makes outbound requests, so
// a Free-plan bot is stopped every time the idle timer expires (the next HTTP
// request starts it again, ~1 min later) - which is why a freshly deployed bot
// answers for a while and then silently goes quiet.
//
// This module sends a periodic GET to the service's own public URL. Those
// requests reach the app through Render's proxy, so they count as inbound
// traffic and the idle timer never expires.
//
// It is opt-in (KEEPALIVE=true) because it is a workaround for a plan limit,
// not a feature of the app: Render documents paid plans as the supported way to
// keep a service running continuously.
const logger = require('./logger');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 min < the 15 min idle window

function start({ baseUrl, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (!baseUrl) {
        logger.warn('KEEPALIVE=true but no public URL is known (RENDER_EXTERNAL_URL is unset) - keep-alive disabled');
        return null;
    }

    const url = `${baseUrl.replace(/\/$/, '')}/health`;
    // Guard rail: never hammer the service, even if the interval is junk.
    const period = Math.max(5000, Number(intervalMs) || DEFAULT_INTERVAL_MS);

    let failures = 0;

    const ping = async () => {
        try {
            const startedAt = Date.now();
            const response = await fetch(url, {
                // Never let a stuck ping pile up with the next one.
                signal: AbortSignal.timeout(30000),
                headers: { 'user-agent': 'confession-bot-keepalive' }
            });
            failures = 0;
            logger.debug(`Keep-alive ping ${url} -> ${response.status} in ${Date.now() - startedAt}ms`);
        } catch (error) {
            failures += 1;
            // Only the first failure is interesting; a burst of them is not.
            if (failures === 1) {
                logger.warn(`Keep-alive ping failed (${error.message}) - the Free plan may spin the service down`);
            }
        }
    };

    // Fire shortly after boot: a restart means the idle clock has just reset,
    // but pinging early also confirms the public URL is reachable.
    const initial = setTimeout(ping, Math.min(30000, period));
    const timer = setInterval(ping, period);

    // Timers must not hold the process open on their own; the HTTP server does.
    initial.unref();
    timer.unref();

    logger.info(`🔁 Keep-alive enabled: GET ${url} every ${Math.round(period / 60000)} min`);
    logger.info('   (Free-plan workaround - a paid instance type removes the need for it)');

    return () => {
        clearTimeout(initial);
        clearInterval(timer);
    };
}

module.exports = { start, DEFAULT_INTERVAL_MS };

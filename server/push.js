// Web Push (VAPID) — works on iOS 16.4+ when Baton is added to the home screen.
import webpush from 'web-push';
import { getKV, setKV, listPushSubs, removePushSub, addEvent } from './store.js';
import { tr } from './i18n.js';

let keys = getKV('vapid');
if (!keys) {
  keys = webpush.generateVAPIDKeys();
  setKV('vapid', keys);
}
// Apple's push service rejects `mailto:…@localhost` subjects (403 BadJwtToken); use Baton's own https origin.
function vapidSubject() {
  const o = getKV('public_origin', null);
  return o && /^https:\/\//.test(o) ? o : 'https://github.com/SongKye/baton';
}
export function setPublicOrigin(origin) {
  if (!origin || !/^https:\/\//.test(origin) || getKV('public_origin', null) === origin) return;
  setKV('public_origin', origin);
}

export const vapidPublicKey = keys.publicKey;

/** Send to every subscribed device and record in the in-app inbox. */
export async function notify({ kind, title, body, url, tag }) {
  addEvent(kind, title, body, url);
  const payload = JSON.stringify({ title, body, url, tag: tag || kind });
  const subs = listPushSubs();
  webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  const opts = { TTL: 6 * 3600, urgency: kind === 'nudge' ? 'low' : 'normal', ...(proxy ? { proxy } : {}) };
  await Promise.all(subs.map(async (s) => {
    // Network errors (no HTTP status) are usually transient — retry a few times before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        await webpush.sendNotification(s, payload, opts);
        return;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { removePushSub(s.endpoint); return; }
        if (!e.statusCode && attempt < 2) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
        console.warn('[push] failed', e.statusCode || describeError(e), e.body || '');
        return;
      }
    }
  }));
  return subs.length;
}

// AggregateError (e.g. IPv4+IPv6 connect both failing) has an empty message — surface the inner codes.
function describeError(e) {
  const inner = Array.isArray(e.errors) ? e.errors.map((x) => x.code || x.message).join(',') : '';
  return [e.code || e.name, e.message, inner].filter(Boolean).join(' ');
}

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
  return o && /^https:\/\//.test(o) ? o : 'https://baton.app';
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
  await Promise.all(subs.map(async (s) => {
    try {
      const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
      await webpush.sendNotification(s, payload, { TTL: 6 * 3600, urgency: kind === 'nudge' ? 'low' : 'normal', ...(proxy ? { proxy } : {}) });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) removePushSub(s.endpoint);
      else console.warn('[push] failed', e.statusCode || e.message, e.body || '');
    }
  }));
  return subs.length;
}

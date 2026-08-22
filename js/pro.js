/* Licence checking, against Gumroad.
 *
 * How this works, and what it is not:
 *
 * Gumroad issues a licence key per sale. `POST /v2/licenses/verify` takes a
 * product id and a key and answers whether that key is real, plus the purchase
 * behind it. The product id is public — it is in the product's own page source
 * — and the endpoint needs no access token, which is the whole reason this can
 * live in an extension at all. Nothing here can read the account, list sales,
 * or touch anything but the one key the user typed.
 *
 * This is a lock on an honest door. Every check happens in code the user owns,
 * on a machine they control, and anybody willing to open devtools can flip the
 * flag. That is true of every client-side licence and is not worth pretending
 * otherwise; the point is that buying is easier than bypassing, not that
 * bypassing is impossible. So: no obfuscation, no fingerprinting, no phoning
 * home with anything except the key the user chose to enter.
 *
 * Deliberate choices that follow from that:
 *
 *  - The key lives under its own storage key, not in settings. Settings get
 *    exported to a file people email around and paste into bug reports, and a
 *    licence key in one of those is somebody's purchase given away.
 *
 *  - A network failure never revokes anything. Aeroplanes, captive portals and
 *    Gumroad outages are all more likely than a refund, and a new tab page that
 *    silently drops paid features because the wifi dropped is worse than one
 *    that trusts a stale check. Only an explicit "this key is not valid"
 *    answer turns pro off.
 *
 *  - Re-checks are weekly, not per tab. A new tab page opens dozens of times a
 *    day; a request on each one would be both rude and pointless.
 */
import { store } from './util.js';
import { GUMROAD } from './config.js';

const KEY = 'license';
const VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

/** How stale a good check may get before it is quietly re-run. */
const REVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;

/** Gumroad keys look like ABCD1234-EF567890-.... Checked loosely, only to catch
 *  somebody pasting an order number or an email address into the box, so the
 *  error can say so instead of making them wait for a round trip. */
const KEY_SHAPE = /^[A-Z0-9]{4,}(-[A-Z0-9]{4,}){1,5}$/;

const listeners = new Set();

/** The live view. Never assigned wholesale — settings.js keeps a reference. */
export const PRO = {
  ok: false,
  key: '',
  email: '',
  at: 0,          // ms epoch of the last definitive answer
  checking: false,
};

/** Whether the paid features are available.
 *
 *  Note the second half. With no product id there is no way to check a key, so
 *  there is no way to buy one either — and locking a feature behind a door with
 *  no handle is worse than not shipping it. An unconfigured build therefore
 *  gives everyone the features rather than nobody.
 *
 *  This is also the switch. Filling in GUMROAD.productId turns the paywall on
 *  by itself; there is no second flag to remember, and no state where the id is
 *  set but the gate is still open. */
export const isPro = () => PRO.ok || !configured();
export const configured = () => !!GUMROAD.productId;

export function onProChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(PRO); } catch (e) { console.error(e); } } }

function apply(next) {
  Object.assign(PRO, next);
  emit();
}

async function save() {
  await store.set(KEY, { key: PRO.key, ok: PRO.ok, email: PRO.email, at: PRO.at });
}

export const normaliseKey = k => String(k || '').trim().toUpperCase();

/** Ask Gumroad about a key.
 *
 *  Returns one of:
 *    { verdict: 'valid',   email }
 *    { verdict: 'invalid', reason }   — a definitive no
 *    { verdict: 'unknown', reason }   — could not tell; caller must not revoke
 */
async function askGumroad(key) {
  if (!GUMROAD.productId) return { verdict: 'unknown', reason: 'No product configured' };

  let res, body;
  try {
    res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_id: GUMROAD.productId,
        license_key: key,
        // Gumroad counts a verification as a "use" by default, which turns an
        // automatic weekly re-check into a use counter that climbs forever and
        // makes the number on the dashboard meaningless.
        increment_uses_count: 'false',
      }),
    });
  } catch {
    return { verdict: 'unknown', reason: 'offline' };
  }

  try {
    body = await res.json();
  } catch {
    // A captive portal answering with an HTML login page looks exactly like
    // this, and is emphatically not an invalid key.
    return { verdict: 'unknown', reason: 'bad response' };
  }

  // A wrong key comes back as HTTP 404 with success:false, so the status alone
  // cannot be used to tell "no such key" from "the server fell over".
  if (body && body.success === true) {
    const p = body.purchase || {};
    if (p.refunded) return { verdict: 'invalid', reason: 'This purchase was refunded' };
    if (p.chargebacked || p.disputed) return { verdict: 'invalid', reason: 'This purchase is disputed' };
    if (p.subscription_cancelled_at || p.subscription_failed_at) {
      return { verdict: 'invalid', reason: 'This subscription has ended' };
    }
    return { verdict: 'valid', email: p.email || '' };
  }

  if (body && body.success === false) {
    return { verdict: 'invalid', reason: body.message || 'That key was not recognised' };
  }
  if (res.status >= 500) return { verdict: 'unknown', reason: 'Gumroad is unavailable' };
  return { verdict: 'unknown', reason: 'Unexpected response' };
}

/** Enter a key. Resolves to { ok, message }. */
export async function activate(raw) {
  const key = normaliseKey(raw);
  if (!key) return { ok: false, message: 'Paste your licence key first' };
  if (!KEY_SHAPE.test(key)) {
    return { ok: false, message: 'That does not look like a licence key' };
  }
  if (!GUMROAD.productId) {
    return { ok: false, message: 'Licensing is not set up in this build' };
  }

  apply({ checking: true });
  const r = await askGumroad(key);
  apply({ checking: false });

  if (r.verdict === 'valid') {
    apply({ ok: true, key, email: r.email || '', at: Date.now() });
    await save();
    return { ok: true, message: 'Pro unlocked — thank you' };
  }
  if (r.verdict === 'invalid') {
    return { ok: false, message: r.reason };
  }
  // Could not reach Gumroad. The key is not stored, because storing an
  // unverified one and treating it as good on the next load would make the
  // whole check optional.
  return { ok: false, message: 'Could not reach Gumroad — check your connection' };
}

export async function deactivate() {
  apply({ ok: false, key: '', email: '', at: 0 });
  await store.remove(KEY);
}

/** Re-check a stored key if it has gone stale. Fire and forget. */
async function revalidate() {
  if (!PRO.key || !PRO.ok) return;
  if (Date.now() - PRO.at < REVALIDATE_MS) return;
  const r = await askGumroad(PRO.key);
  if (r.verdict === 'valid') {
    apply({ at: Date.now(), email: r.email || PRO.email });
    await save();
  } else if (r.verdict === 'invalid') {
    apply({ ok: false, at: Date.now() });
    await save();
  }
  // 'unknown' leaves everything exactly as it was, including the old
  // timestamp, so the next tab tries again rather than waiting another week.
}

export async function initPro() {
  const saved = await store.get(KEY, null);
  if (saved && typeof saved === 'object') {
    apply({
      ok: !!saved.ok,
      key: typeof saved.key === 'string' ? saved.key : '',
      email: typeof saved.email === 'string' ? saved.email : '',
      at: Number(saved.at) || 0,
    });
  }
  // Not awaited: the page has no reason to wait on a network round trip to
  // paint, and the listeners will pick up a change if one comes.
  revalidate();
  return PRO;
}

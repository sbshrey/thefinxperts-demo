import { buildReviewBackup, parseReviewBackup } from './review-backup.mjs?v=f234c17f6728';

const PREFIX = 'thefinxperts-review-handoff-';
const TOKEN = /^#handoff=([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const WAIT_MS = 15_000;

/** Keep both tabs open and pass only a normalized review over a same-origin channel. */
export function prepareReviewHandoff(event, portfolio, destination, unavailable) {
  if (!portfolio?.holdings?.length) return false;
  if (typeof BroadcastChannel === 'undefined') {
    event.preventDefault();
    unavailable();
    return true;
  }
  const token = crypto.randomUUID();
  const channel = new BroadcastChannel(`${PREFIX}${token}`);
  let sent = false;
  const timeout = setTimeout(() => channel.close(), WAIT_MS);
  channel.onmessage = ({ data }) => {
    if (data?.type === 'ready' && !sent) {
      sent = true;
      channel.postMessage({ type: 'portfolio', portfolio: buildReviewBackup(portfolio) });
    } else if (data?.type === 'received') {
      clearTimeout(timeout);
      channel.close();
    }
  };
  const url = new URL(destination, location.href);
  url.hash = `handoff=${token}`;
  event.currentTarget.href = url.href;
  event.currentTarget.target = '_blank';
  event.currentTarget.rel = 'noopener noreferrer';
  return true;
}

/** A failed handoff leaves the destination empty and offers file restore. */
export function receiveReviewHandoff({ onStart, onPortfolio, onError }) {
  const token = TOKEN.exec(location.hash)?.[1];
  if (!token) return false;
  history.replaceState(null, '', location.pathname + location.search);
  onStart();
  if (typeof BroadcastChannel === 'undefined') {
    onError('unsupported');
    return true;
  }
  const channel = new BroadcastChannel(`${PREFIX}${token}`);
  const timeout = setTimeout(() => {
    channel.close();
    onError('timeout');
  }, WAIT_MS);
  channel.onmessage = ({ data }) => {
    if (data?.type !== 'portfolio') return;
    try {
      const parsed = parseReviewBackup(JSON.stringify(data.portfolio));
      if (parsed.errors.length) throw new Error('Invalid review');
      onPortfolio(parsed.portfolio);
      channel.postMessage({ type: 'received' });
    } catch {
      onError('invalid');
    } finally {
      clearTimeout(timeout);
      channel.close();
    }
  };
  channel.postMessage({ type: 'ready' });
  return true;
}

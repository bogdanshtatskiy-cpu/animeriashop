import { randomUUID } from 'node:crypto';
import { database } from '../server/firebase.js';
import { HttpError, post } from '../server/http.js';
import { equalSecret, sendMessage } from '../server/telegram.js';

export default post(async (request, response, body) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const supplied = request.headers['x-telegram-bot-api-secret-token'];
  if (!secret) throw new HttpError(503, 'WEBHOOK_CONFIG', 'Webhook configuration missing.');
  if (typeof supplied !== 'string' || !equalSecret(secret, supplied)) throw new HttpError(401, 'WEBHOOK_AUTH', 'Unauthorized.');

  const message = body.message as {
    text?: string;
    from?: { id?: number; is_bot?: boolean };
    chat?: { id?: number; type?: string };
  } | undefined;
  const userId = message?.from?.id;
  const text = message?.text?.match(/^\/review(?:@\w+)?[ \t\n]+([\s\S]+)$/i)?.[1].trim();
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0 || message?.from?.is_bot
    || message?.chat?.type !== 'private' || message.chat.id !== userId || !text || text.length > 1400
    || !Number.isSafeInteger(body.update_id) || (body.update_id as number) < 0) return response.json({ ok: true });

  const db = database();
  const channel = process.env.REVIEWS_CHANNEL_ID?.trim();
  const review = db.collection('reviews').doc('tg-' + body.update_id);
  const reviewUser = db.collection('review_locks').doc(String(userId));
  const lease = randomUUID();
  const now = Date.now();
  const state = await db.runTransaction(async (tx) => {
    const [existing, lock] = await tx.getAll(review, reviewUser);
    if (existing.exists) {
      if (existing.get('publication') === 'published' || !channel) return 'finished';
      if (existing.get('leaseUntil') > now) return 'busy';
      tx.update(review, { lease, leaseUntil: now + 15_000 });
      return 'publish';
    }

    const orders = await tx.get(db.collection('orders').where('userId', '==', userId).where('status', '==', 'completed'));
    const previousCount = lock.exists ? Number(lock.get('count')) : (
      await tx.get(db.collection('reviews').where('userId', '==', userId))
    ).size;
    if (orders.size <= previousCount) return 'finished';
    tx.set(reviewUser, { count: previousCount + 1 });
    tx.create(review, {
      userId, text, createdAt: now, orderCountAtReview: orders.size, publication: 'pending',
      ...(channel ? { lease, leaseUntil: now + 15_000 } : {}),
    });
    return channel ? 'publish' : 'saved';
  });

  if (state === 'busy') return response.status(503).json({ ok: false });
  if (state === 'publish' && channel) {
    const error = await sendMessage(channel, 'Відгук про Animeria\n\n' + text);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(review);
      if (snapshot.get('lease') === lease) tx.update(review, { publication: error ? 'pending' : 'published', leaseUntil: 0 });
    });
    if (error) return response.status(502).json({ ok: false });
    await sendMessage(userId, 'Дякуємо за відгук. Ми опублікували його анонімно.');
  }
  if (state === 'saved') await sendMessage(userId, 'Дякуємо. Ваш відгук збережено.');
  return response.json({ ok: true });
});

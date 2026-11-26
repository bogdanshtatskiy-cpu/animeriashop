import type { DocumentReference } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { money, orderNumber, orderStatus, toKop } from '../src/lib/commerce.js';
import type { Order } from '../src/store/useOrdersStore.js';
import { HttpError } from './http.js';
import { sendMessage } from './telegram.js';

export async function deliverOrderNotification(ref: DocumentReference, type: 'adminNotice' | 'customerNotice') {
  const lease = randomUUID();
  const task = await ref.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'NOT_FOUND', 'Замовлення не знайдено.');
    const order = { ...snapshot.data(), id: ref.id } as Order;
    const notice = order[type];
    if (type === 'customerNotice' && !notice) throw new HttpError(409, 'NO_NOTICE', 'Для цього замовлення немає сповіщення.');
    if (notice?.state === 'sent') return null;
    if (notice?.leaseUntil && notice.leaseUntil > Date.now()) {
      throw new HttpError(409, 'NOTICE_BUSY', 'Сповіщення вже надсилається. Зачекайте кілька секунд.');
    }
    tx.update(ref, { [type]: { state: 'sending', lease, leaseUntil: Date.now() + 15_000 } });
    return order;
  });
  if (!task) return { sent: true };

  const destination = type === 'adminNotice' ? process.env.ADMIN_TELEGRAM_ID?.trim() : task.userId;
  const number = orderNumber(ref.id);
  const items = Array.isArray(task.items) ? task.items.map(item => {
    const variant = item.selectedColor ? ' / ' + item.selectedColor : '';
    return item.quantity + ' × ' + item.title + variant;
  }).join('\n') : '';
  const text = type === 'adminNotice'
    ? ['Animeria · Нове замовлення ' + number, money(toKop(task.totalPrice)), items, 'Контакти й доставка — в адмінпанелі.'].join('\n\n')
    : [
      'Animeria · Замовлення ' + number,
      orderStatus[task.status],
      task.status === 'shipped' && task.ttn ? 'ТТН Нової пошти: ' + task.ttn : '',
      task.status === 'completed' ? 'Щоб залишити відгук, надішліть /review і текст одним повідомленням.' : '',
    ].filter(Boolean).join('\n\n');

  const result = destination
    ? await sendMessage(destination, text).catch(() => ({ description: 'Налаштування Telegram відсутні.' }))
    : { description: 'ADMIN_TELEGRAM_ID не налаштовано.' };
  await ref.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.get(type)?.lease !== lease) return;
    tx.update(ref, { [type]: result ? { state: 'failed', error: result } : { state: 'sent', at: Date.now() } });
  });
  return result ? { sent: false, telegram: result } : { sent: true };
}

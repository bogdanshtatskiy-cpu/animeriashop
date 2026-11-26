import { database } from '../server/firebase.js';
import { documentId, HttpError, post } from '../server/http.js';
import { telegramUser } from '../server/telegram.js';

export default post(async (_request, response, body) => {
  const user = telegramUser(body.initData);
  const entries = database().collection('orders');
  const base = entries.where('userId', '==', user.id).orderBy('createdAt', 'desc').limit(21);
  let query = base;
  if (body.cursor !== undefined) {
    const cursor = await entries.doc(documentId(body.cursor)).get();
    if (!cursor.exists || cursor.get('userId') !== user.id) throw new HttpError(400, 'INVALID_CURSOR', 'Оновіть історію замовлень.');
    query = base.startAfter(cursor);
  }
  const snapshot = await query.get();
  const orders = snapshot.docs.slice(0, 20).map(doc => {
    const { status, createdAt, items, totalPrice, ttn } = doc.data();
    return { id: doc.id, status, createdAt, items, totalPrice, ttn };
  });
  return response.json({ orders, ...(snapshot.size > 20 ? { cursor: orders.at(-1)?.id } : {}) });
});

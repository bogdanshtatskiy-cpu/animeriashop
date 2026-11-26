import { database } from '../server/firebase.js';
import { documentId, HttpError, post, requireField } from '../server/http.js';
import { telegramUser } from '../server/telegram.js';

const list = (value: unknown): string[] => Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 250) : [];

export default post(async (_request, response, body) => {
  const user = telegramUser(body.initData);
  const ref = database().collection('favorites').doc(String(user.id));
  if (body.action === 'read') return response.json({ items: list((await ref.get()).get('items')) });
  requireField(body.action === 'set' && typeof body.selected === 'boolean', 'Невідома дія.');
  const id = documentId(body.id);
  await ref.firestore.runTransaction(async tx => {
    const items = new Set(list((await tx.get(ref)).get('items')));
    if (body.selected) {
      if (items.size >= 250 && !items.has(id)) throw new HttpError(409, 'FAVORITES_LIMIT', 'В обраному може бути до 250 товарів.');
      items.add(id);
    } else {
      items.delete(id);
    }
    tx.set(ref, { items: [...items] });
  });
  return response.json({ ok: true });
});

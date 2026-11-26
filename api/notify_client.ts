import { FieldValue } from 'firebase-admin/firestore';
import { orderTransitions } from '../src/lib/commerce.js';
import type { OrderStatus } from '../src/lib/commerce.js';
import { isTrackedStock } from '../server/checkout.js';
import { database, requireAdmin } from '../server/firebase.js';
import { documentId, HttpError, post, requireField, stringField } from '../server/http.js';
import { deliverOrderNotification } from '../server/notifications.js';

export default post(async (request, response, body) => {
  await requireAdmin(request);
  const db = database();
  const ref = db.collection('orders').doc(documentId(body.orderId));
  if (body.action !== 'retry') {
    const status = stringField(body.status, 20) as OrderStatus;
    requireField(Object.hasOwn(orderTransitions, status) && status !== 'new', 'Некоректний статус.');
    const ttn = status === 'shipped' ? stringField(body.ttn, 20).replace(/\s/g, '') : '';
    requireField(status !== 'shipped' || /^\d{14}$/.test(ttn), 'Вкажіть 14 цифр номера ТТН.');
    await db.runTransaction(async (tx) => {
      const order = await tx.get(ref);
      if (!order.exists) throw new HttpError(404, 'NOT_FOUND', 'Замовлення не знайдено.');
      const current = order.get('status') as OrderStatus;
      if (current === status && (status !== 'shipped' || order.get('ttn') === ttn)) return;
      if (!orderTransitions[current]?.includes(status)) throw new HttpError(409, 'INVALID_STATUS', 'Цей перехід статусу недоступний.');
      if (order.get('customerNotice.leaseUntil') > Date.now()) throw new HttpError(409, 'NOTICE_BUSY', 'Попереднє сповіщення ще надсилається.');
      if (status === 'cancelled' && current !== 'shipped') {
        const quantities = order.get('reservedStock') as { id: string; quantity: number }[] | undefined;
        if (quantities?.length) {
          const products = await tx.getAll(...quantities.flatMap(item => [
            db.collection('products').doc(item.id), db.collection('product_drafts').doc(item.id),
          ]));
          quantities.forEach(({ quantity }, index) => {
            const current = products[index * 2];
            const product = current.exists ? current : products[index * 2 + 1];
            if (product.exists && isTrackedStock(product.get('stock'))) tx.update(product.ref, { stock: FieldValue.increment(quantity) });
          });
        }
      }
      tx.update(ref, { status, ...(ttn ? { ttn } : {}), customerNotice: { state: 'pending' } });
    });
  }
  const result = await deliverOrderNotification(ref, 'customerNotice');
  return response.json({ success: true, ...result });
});

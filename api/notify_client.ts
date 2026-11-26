import { configuredStock, finishStock, orderTransitions } from '../src/lib/commerce.js';
import type { OrderStatus } from '../src/lib/commerce.js';
import type { StockReservation } from '../server/checkout.js';
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
    const ttn = status === 'shipped' ? stringField(body.ttn ?? '', 40).replace(/\s/g, '') : '';
    const notify = await db.runTransaction(async (tx) => {
      const order = await tx.get(ref);
      if (!order.exists) throw new HttpError(404, 'NOT_FOUND', 'Замовлення не знайдено.');
      const current = order.get('status') as OrderStatus;
      const notifyCustomer = !order.get('manual');
      if (status === 'shipped') {
        if (notifyCustomer || order.get('manual.delivery') === 'nova-poshta') {
          requireField(/^\d{14}$/.test(ttn), 'Вкажіть 14 цифр номера ТТН.');
        } else requireField(!ttn || /^[\p{L}\p{N}._-]+$/u.test(ttn), 'Перевірте трек-номер.');
      }
      if (current === status && (status !== 'shipped' || (order.get('ttn') ?? '') === ttn)) return notifyCustomer;
      if (!orderTransitions[current]?.includes(status)) throw new HttpError(409, 'INVALID_STATUS', 'Цей перехід статусу недоступний.');
      if (order.get('customerNotice.leaseUntil') > Date.now()) throw new HttpError(409, 'NOTICE_BUSY', 'Попереднє сповіщення ще надсилається.');
      if (status === 'cancelled' && current !== 'shipped') {
        const quantities = order.get('reservedStock') as StockReservation[] | undefined;
        if (quantities?.length) {
          const products = await tx.getAll(...quantities.flatMap(item => [
            db.collection('products').doc(item.id), db.collection('product_drafts').doc(item.id),
          ]));
          quantities.forEach(({ quantity, finishes }, index) => {
            const current = products[index * 2];
            const product = current.exists ? current : products[index * 2 + 1];
            if (!product.exists) return;
            const stock = configuredStock(product.get('stock'));
            const remaining = product.get('variantStock') as Record<string, number> | null ?? {};
            const restored = new Map(Object.entries(remaining));
            for (const finish of finishes ?? []) {
              const tracked = finishStock({ variantStock: remaining }, finish.color);
              if (tracked !== undefined) restored.set(finish.color, tracked + finish.quantity);
            }
            if ((quantity && stock !== undefined) || finishes?.length) tx.update(product.ref, {
              ...(quantity && stock !== undefined ? { stock: stock + quantity } : {}),
              ...(finishes?.length ? { variantStock: Object.fromEntries(restored) } : {}),
            });
          });
        }
      }
      tx.update(ref, { status, ...(ttn ? { ttn } : {}), ...(notifyCustomer ? { customerNotice: { state: 'pending' } } : {}) });
      return notifyCustomer;
    });
    if (!notify) return response.json({ success: true, sent: false, skipped: true });
  } else {
    const order = await ref.get();
    if (!order.exists) throw new HttpError(404, 'NOT_FOUND', 'Замовлення не знайдено.');
    if (order.get('manual')) return response.json({ success: true, sent: false, skipped: true });
  }
  const result = await deliverOrderNotification(ref, 'customerNotice');
  return response.json({ success: true, ...result });
});

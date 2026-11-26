import { createHash } from 'node:crypto';
import { configuredStock, finishStock } from '../src/lib/commerce.js';
import type { StockReservation } from '../server/checkout.js';
import { checkoutId, makeQuote, parseLines, verifyMinimum } from '../server/checkout.js';
import { database } from '../server/firebase.js';
import { HttpError, post, requireField, stringField } from '../server/http.js';
import { deliverOrderNotification } from '../server/notifications.js';
import { verifyDelivery } from '../server/nova-poshta.js';
import { telegramUser } from '../server/telegram.js';

export default post(async (_request, response, body) => {
  const user = telegramUser(body.initData);
  const db = database();
  if (body.action === 'status') {
    const key = checkoutKey(body.key);
    const order = await db.collection('orders').doc(checkoutId(user.id, key)).get();
    return response.json({ receipt: order.exists ? { id: order.id, total: Math.round(order.get('totalPrice') * 100) } : null });
  }
  const lines = parseLines(body.items);
  const code = body.promo === undefined ? '' : stringField(body.promo, 40).toUpperCase();
  if (body.action === 'quote') {
    const { quote } = await makeQuote(db, lines, code);
    return response.json({ quote });
  }

  requireField(body.action === 'place', 'Невідома дія.');
  const key = checkoutKey(body.key);
  const expectedTotal = body.expectedTotal as number;
  requireField(Number.isSafeInteger(expectedTotal) && expectedTotal >= 0, 'Перевірте підсумок замовлення.');
  const firstName = stringField(body.firstName, 64);
  const lastName = stringField(body.lastName, 64);
  const phone = stringField(body.phone, 16);
  requireField(firstName && lastName && !/[\p{Cc}]/u.test(firstName + lastName), 'Вкажіть ім’я та прізвище.');
  requireField(/^\+380[1-9]\d{8}$/.test(phone), 'Вкажіть номер телефону у форматі +380.');
  const { expiresAt, ...delivery } = verifyDelivery(body.deliveryProof, user.id);
  const requestHash = createHash('sha256').update(JSON.stringify({
    lines, code, expectedTotal, firstName, lastName, phone, cityRef: delivery.cityRef, branchRef: delivery.branchRef,
  })).digest('hex');
  const ref = db.collection('orders').doc(checkoutId(user.id, key));
  const throttle = db.collection('checkout_limits').doc(String(user.id));
  const order = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      if (existing.get('requestHash') !== requestHash) throw new HttpError(409, 'CHECKOUT_CONFLICT', 'Цей запит уже оформлено. Перевірте замовлення у профілі.');
      return { total: Math.round(existing.get('totalPrice') * 100), created: false };
    }

    const limit = await tx.get(throttle);
    const now = Date.now();
    requireField(expiresAt > now, 'Оберіть відділення Нової пошти ще раз.', 'DELIVERY_EXPIRED');
    const hour = Math.floor(now / 3600_000);
    const count = limit.get('hour') === hour ? Number(limit.get('count')) || 0 : 0;
    if (count >= 8) throw new HttpError(429, 'CHECKOUT_LIMIT', 'Ліміт замовлень на годину вичерпано.');
    const { items, quote, products, promo } = await makeQuote(db, lines, code, tx);
    verifyMinimum(quote.subtotal);
    if (quote.total !== expectedTotal) throw new HttpError(409, 'PRICE_CHANGED', 'Ціна змінилася. Перевірте оновлений підсумок.');
    const reservedStock: StockReservation[] = [];
    for (const [id, product] of products) {
      const productItems = items.filter(item => item.id === id);
      const stock = configuredStock(product.stock);
      const quantity = stock === undefined ? 0 : productItems.reduce((sum, item) => sum + item.quantity, 0);
      const variantStock = new Map(Object.entries(product.variantStock ?? {}));
      const finishUnits = new Map<string, number>();
      for (const item of productItems) {
        const color = item.selectedColor ?? '';
        if (finishStock(product, color) !== undefined) finishUnits.set(color, (finishUnits.get(color) ?? 0) + item.quantity);
      }
      const finishes = [...finishUnits].map(([color, quantity]) => {
        variantStock.set(color, variantStock.get(color)! - quantity);
        return { color, quantity };
      });
      if (!quantity && !finishes.length) continue;
      reservedStock.push({ id, quantity, ...(finishes.length ? { finishes } : {}) });
      tx.update(db.collection('products').doc(id), {
        ...(stock === undefined ? {} : { stock: stock - quantity }),
        ...(finishes.length ? { variantStock: Object.fromEntries(variantStock) } : {}),
      });
    }
    if (promo) tx.update(promo.ref, { usageCount: promo.nextCount });
    tx.set(throttle, { hour, count: count + 1 });
    tx.create(ref, {
      userId: user.id, username: user.username ?? '', firstName, lastName, items, requestHash, reservedStock,
      shippingDetails: { ...delivery, phone },
      totalPrice: quote.total / 100, subtotal: quote.subtotal / 100, ...(code ? { promoCode: code } : {}),
      status: 'new', createdAt: now, adminNotice: { state: 'pending' },
    });
    return { total: quote.total, created: true };
  });
  if (order.created) {
    await deliverOrderNotification(ref, 'adminNotice').catch(() => console.warn('New order notification deferred', { orderId: ref.id }));
  }
  return response.status(order.created ? 201 : 200).json({ id: ref.id, total: order.total });
});

function checkoutKey(input: unknown) {
  const key = stringField(input, 36);
  requireField(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key), 'Оновіть сторінку й повторіть оформлення.');
  return key.toLowerCase();
}

import { createHash } from 'node:crypto';
import { MAX_ORDER_LINES, toKop } from '../src/lib/commerce.js';
import { deliveryMethods, orderSources, paymentMethods } from '../src/lib/manual-order.js';
import { database, requireAdmin } from '../server/firebase.js';
import { HttpError, post, record, requireField, stringField } from '../server/http.js';

export default post(async (request, response, body) => {
  const admin = await requireAdmin(request);
  const key = stringField(body.key, 36);
  requireField(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key), 'Оновіть сторінку й повторіть збереження.');

  const firstName = stringField(body.name, 128);
  const phone = stringField(body.phone, 32);
  const city = stringField(body.city, 100);
  const branch = stringField(body.destination, 240);
  const contact = stringField(body.contact, 150);
  const note = stringField(body.note, 2000);
  const source = option(orderSources, body.source);
  const delivery = option(deliveryMethods, body.delivery);
  const payment = option(paymentMethods, body.payment);
  requireField(firstName, 'Вкажіть ім’я замовника.');
  requireField(phone || contact, 'Вкажіть телефон або інший контакт.');
  requireField(!phone || (/^\+?[\d ()-]+$/.test(phone) && /^\d{7,15}$/.test(phone.replace(/\D/g, ''))), 'Перевірте номер телефону.');
  requireField((delivery === 'pickup' || city) && branch, 'Укажіть місце отримання.');

  requireField(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= MAX_ORDER_LINES, 'Додайте від 1 до 30 позицій.');
  const items = body.items.map((input, index) => {
    const item = record(input);
    const title = stringField(item.title, 240);
    const quantity = item.quantity as number;
    const unitPrice = amount(item.price);
    requireField(title && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 999, 'Перевірте назву й кількість кожної позиції.');
    const id = 'manual-line-' + (index + 1);
    return { id, cartItemId: id, title, quantity, price: unitPrice / 100, unitPrice };
  });
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const paid = amount(body.paid);
  requireField(total > 0 && paid <= total, 'Перевірте суму замовлення й отриману оплату.');

  const order = {
    firstName, items, totalPrice: total / 100,
    shippingDetails: { phone, city, branch },
    manual: { source, delivery, payment, paid: paid / 100, contact, note },
  };
  const requestHash = createHash('sha256').update(JSON.stringify(order)).digest('hex');
  const id = createHash('sha256').update('manual:' + admin.uid + ':' + key.toLowerCase()).digest('hex').slice(0, 32);
  const db = database();
  const ref = db.collection('orders').doc(id);
  const created = await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      if (existing.get('requestHash') !== requestHash) throw new HttpError(409, 'ORDER_EXISTS', 'Замовлення вже створено. Перевірте активні замовлення.');
      return false;
    }
    tx.create(ref, { ...order, requestHash, status: 'new', createdAt: Date.now() });
    return true;
  });
  return response.status(created ? 201 : 200).json({ id });
});

function option<T extends object>(values: T, input: unknown) {
  requireField(typeof input === 'string' && Object.hasOwn(values, input), 'Перевірте джерело, доставку та оплату.');
  return input as keyof T;
}

function amount(value: unknown) {
  requireField(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000, 'Перевірте суму.');
  const kop = toKop(value);
  requireField(kop / 100 === value, 'У сумі має бути до двох знаків після коми.');
  return kop;
}

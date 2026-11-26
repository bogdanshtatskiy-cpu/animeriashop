import { createHash } from 'node:crypto';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { configuredStock, discounted, finishStock, giftPrice, MAX_LINE_QUANTITY, MAX_ORDER_LINES, MIN_ORDER_KOP, unitPrice, variantKey } from '../src/lib/commerce.js';
import type { CheckoutLine, Quote } from '../src/lib/commerce.js';
import type { CartItem, Product } from '../src/store/useCartStore.js';
import { documentId, HttpError, record, requireField, stringField } from './http.js';

type PricedLine = CartItem & { unitPrice: number };

export function parseLines(input: unknown): CheckoutLine[] {
  requireField(Array.isArray(input) && input.length > 0 && input.length <= MAX_ORDER_LINES, 'Перевірте кількість позицій у кошику.');
  const lines = new Map<string, CheckoutLine>();
  for (const value of input) {
    const line = record(value);
    const id = documentId(line.id);
    const color = line.color === undefined ? '' : stringField(line.color, 80);
    requireField(line.gift === undefined || typeof line.gift === 'boolean', 'Перевірте комплектацію виробу.');
    const gift = line.gift === true;
    const key = variantKey(id, color, gift);
    const quantity = line.quantity as number;
    requireField(Number.isInteger(quantity) && quantity > 0 && quantity <= MAX_LINE_QUANTITY, 'Перевірте кількість товару.');
    const combined = (lines.get(key)?.quantity ?? 0) + quantity;
    requireField(combined <= MAX_LINE_QUANTITY, 'Перевірте кількість товару.');
    lines.set(key, { id, color, quantity: combined, ...(gift ? { gift } : {}) });
  }
  return [...lines.values()];
}

export function priceLines(lines: CheckoutLine[], products: Map<string, Product>): PricedLine[] {
  const stockRequested = new Map<string, number>();
  const finishRequested = new Map<string, number>();
  return lines.map(({ id, color, quantity, gift }) => {
    const product = products.get(id);
    if (!product || product.available === false || !Number.isFinite(product.price) || product.price <= 0 || product.price > 1_000_000) {
      throw new HttpError(409, 'UNAVAILABLE', 'Один із товарів більше недоступний. Оновіть кошик.');
    }
    const validColors = Array.isArray(product.colors) ? product.colors : [];
    if (validColors.length ? !validColors.includes(color ?? '') : color) {
      throw new HttpError(409, 'UNAVAILABLE', 'Перевірте варіант товару «' + product.title + '».');
    }
    const count = (stockRequested.get(id) ?? 0) + quantity;
    stockRequested.set(id, count);
    const stock = configuredStock(product.stock);
    if (stock !== undefined && count > stock) {
      throw new HttpError(409, 'UNAVAILABLE', '«' + product.title + '» — доступно ' + product.stock + ' шт.');
    }
    const finishKey = variantKey(id, color);
    const finishCount = (finishRequested.get(finishKey) ?? 0) + quantity;
    finishRequested.set(finishKey, finishCount);
    const finish = finishStock(product, color);
    if (finish !== undefined && finishCount > finish) {
      throw new HttpError(409, 'UNAVAILABLE', '«' + product.title + ' / ' + color + '» — доступно ' + finish + ' шт.');
    }
    const surcharge = gift ? giftPrice(product) : 0;
    if (gift && !surcharge) throw new HttpError(409, 'UNAVAILABLE', 'Подарунковий набір для «' + product.title + '» недоступний.');
    const image = product.imageUrls?.[0] || product.imageUrl;
    return {
      id, cartItemId: variantKey(id, color, gift), title: product.title, price: product.price, unitPrice: unitPrice(product) + surcharge,
      ...(gift ? { gift, giftContents: product.giftSet?.contents || 'Паличка, підставка та коробка' } : {}),
      quantity, ...(color ? { selectedColor: color } : {}),
      ...(product.discount ? { discount: product.discount } : {}),
      ...(image ? { imageUrl: image } : {}),
    };
  });
}

export interface StockReservation {
  id: string;
  quantity: number;
  finishes?: { color: string; quantity: number }[];
}

export async function makeQuote(db: Firestore, lines: CheckoutLine[], code: string, transaction?: Transaction) {
  const productRefs = [...new Set(lines.map(line => line.id))].map(id => db.collection('products').doc(id));
  const docs = await (transaction ? transaction.getAll(...productRefs) : db.getAll(...productRefs));
  const products = new Map(docs.filter(doc => doc.exists).map(doc => [doc.id, { ...doc.data(), id: doc.id } as Product]));
  const items = priceLines(lines, products);
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  let total = subtotal;
  let promo: { ref: DocumentReference; nextCount: number } | undefined;
  if (code) {
    const query = db.collection('promocodes').where('code', '==', code).limit(1);
    const snapshot = await (transaction ? transaction.get(query) : query.get());
    const doc = snapshot.docs[0];
    const data = doc?.data();
    const now = Date.now();
    const count = Number(data?.usageCount ?? 0);
    if (!data || (data.validFrom && now < data.validFrom) || (data.validUntil && now > data.validUntil)
      || (data.usageLimit && count >= data.usageLimit) || subtotal < (data.minOrderAmount ?? 0) * 100) {
      throw new HttpError(409, 'INVALID_PROMO', 'Промокод не діє для цього замовлення.');
    }
    total = discounted(subtotal, { type: data.discountType, value: data.discountValue });
    promo = { ref: doc.ref, nextCount: count + 1 };
  }
  const quote: Quote = {
    subtotal, total, ...(code ? { promo: code } : {}),
    lines: items.map(item => ({ id: item.id, color: item.selectedColor ?? '', quantity: item.quantity, unitPrice: item.unitPrice, ...(item.gift ? { gift: true } : {}) })),
  };
  return { quote, items, products, promo };
}

export function checkoutId(userId: number, key: string) {
  return createHash('sha256').update(userId + ':' + key).digest('hex').slice(0, 32);
}

export function verifyMinimum(subtotal: number) {
  if (subtotal < MIN_ORDER_KOP) throw new HttpError(409, 'MIN_ORDER', 'Мінімальна сума замовлення — 250 грн.');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, priceLines } from '../server/checkout';
import { HttpError } from '../server/http';
import { deliveryProof, verifyDelivery } from '../server/nova-poshta';
import { telegramUser } from '../server/telegram';
import { discounted, toKop, unitPrice } from '../src/lib/commerce';
import type { Product } from '../src/store/useCartStore';
import { TEST_TOKEN as token, signUser } from './e2e-fixture';

test('validates authentic Telegram sessions and rejects modified, expired, duplicate, and future fields', () => {
  const now = 1_800_000_000;
  const authentic = signUser(123, now);
  assert.equal(telegramUser(authentic, token, now).id, 123);
  const tampered = authentic.replace('%3A123', '%3A456');
  assert.notEqual(tampered, authentic);
  assert.throws(() => telegramUser(tampered, token, now), HttpError);
  assert.throws(() => telegramUser(authentic + '&auth_date=' + now, token, now), HttpError);
  assert.throws(() => telegramUser(authentic, token, now + 86_401), HttpError);
  assert.throws(() => telegramUser(authentic, token, now - 61), HttpError);
});

test('binds Nova Poshta delivery to the authenticated buyer', () => {
  process.env.TELEGRAM_BOT_TOKEN = token;
  const point = {
    cityRef: '11111111-1111-1111-1111-111111111111', branchRef: '22222222-2222-2222-2222-222222222222',
    city: 'Львів', branch: 'Відділення №12',
  };
  const proof = deliveryProof(point, 123);
  const { expiresAt, ...verified } = verifyDelivery(proof, 123);
  assert.deepEqual(verified, point);
  assert.ok(expiresAt > Date.now());
  assert.throws(() => verifyDelivery(proof, 456), HttpError);
  assert.throws(() => verifyDelivery('x' + proof.slice(1), 123), HttpError);
});

test('prices integer kopiykas and caps discounts at zero', () => {
  assert.equal(toKop(12.344), 1234);
  assert.equal(unitPrice({ price: 345.67, discount: { type: 'percent', value: 10 } }), 31_110);
  assert.equal(discounted(33_900, { type: 'fixed', value: 400 }), 0);
});

test('uses server catalog prices, sums variant stock, and rejects duplicate quantities beyond the limit', () => {
  const product: Product = { id: 'wand', title: 'Паличка', price: 420, colors: ['Бронза', 'Мідь'], stock: 2 };
  const catalog = new Map([[product.id, product]]);
  const lines = parseLines([{ id: 'wand', color: 'Бронза', quantity: 1, price: 1 }, { id: 'wand', color: 'Мідь', quantity: 1 }]);
  assert.deepEqual(priceLines(lines, catalog).map(line => line.unitPrice), [42_000, 42_000]);
  assert.throws(() => priceLines([...lines, lines[0]], catalog), /доступно 2/);
  assert.throws(() => priceLines([{ ...lines[0], color: 'Фіолетовий' }], catalog), /варіант/);
  assert.throws(() => parseLines([{ id: 'wand', quantity: 20 }, { id: 'wand', quantity: 1 }]), HttpError);
});

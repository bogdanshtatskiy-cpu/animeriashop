import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ADMIN_UID } from '../src/lib/admin';
import { CITY, signUser, TEST_WEBHOOK_SECRET } from './e2e-fixture';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Firebase emulators are required.');
const project = initializeApp({ projectId: 'demo-animeria' });
const db = getFirestore(project);
const email = 'admin@animeria.example';
const password = 'local-demo-only-password';

test.beforeEach(async ({ page }) => {
  await Promise.all(['orders', 'favorites', 'checkout_limits', 'reviews', 'review_locks', 'product_drafts', 'promocodes', 'products'].map(path => db.recursiveDelete(db.collection(path))));
  await Promise.all([
    db.doc('products/wand-test').set({
      title: 'Паличка Герміони', character: 'Герміона', price: 450, category: 'Чарівні палички', stock: 2,
      material: 'Фотополімерна смола', technology: 'resin', dimensions: '32 см', finish: 'Ручне фарбування',
      colors: ['Мідь', 'Бронза'], imageUrls: ['/media/atelier.webp', '/logo.png'], featured: true, available: true,
    }),
    db.doc('products/other-test').set({ title: 'Брелок майстерні', price: 120, category: 'Аксесуари', imageUrl: '/logo.png' }),
    db.doc('promocodes/WAND10').set({ code: 'WAND10', discountType: 'percent', discountValue: 10, usageCount: 0, usageLimit: 1 }),
    getAuth(project).getUser(ADMIN_UID).catch(() => getAuth(project).createUser({ uid: ADMIN_UID, email, password })),
  ]);
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.Telegram={WebApp:{initData:' + JSON.stringify(signUser(777)) + ',initDataUnsafe:{user:{id:777,first_name:"Ada",last_name:"Test"}},ready(){},expand(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};',
  }));
});

test('mobile catalog, synced favorites, checkout, and order history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Чарівні палички', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Паличка Герміони' })).toBeVisible();
  await page.getByRole('button', { name: 'До колекції' }).click();
  await expect(page.getByRole('heading', { name: 'Брелок майстерні' })).toHaveCount(0);
  await page.getByRole('searchbox').fill('Герміона');
  await page.getByRole('button', { name: 'Зберегти в обране' }).click();
  await expect(page.getByRole('button', { name: 'Видалити з обраного' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('navigation').getByRole('link', { name: 'Обране' }).click();
  await expect(page.getByRole('heading', { name: 'Паличка Герміони' })).toBeVisible();
  await page.getByRole('heading', { name: 'Паличка Герміони' }).getByRole('link').click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText('Фотополімерний друк')).toBeVisible();
  await expect(detail.getByText('Ручне фарбування')).toBeVisible();
  await detail.getByRole('button', { name: 'Наступне фото' }).click();
  await expect(detail.getByRole('button', { name: 'Фото 2' })).toHaveAttribute('aria-pressed', 'true');
  await detail.getByText('Бронза', { exact: true }).click();
  await detail.getByRole('button', { name: 'Додати в кошик' }).click();
  await detail.getByRole('link', { name: 'До кошика' }).click();
  await expect(page.getByText('Бронза')).toBeVisible();

  await page.getByRole('textbox', { name: 'Телефон' }).fill('0671234567');
  const city = page.getByRole('combobox', { name: 'Місто' });
  await city.fill('Льв');
  await expect(page.getByRole('option', { name: 'Львів', exact: true })).toBeVisible();
  await city.press('ArrowDown');
  await city.press('Enter');
  await expect(city).toHaveValue('Львів');
  await page.getByRole('combobox', { name: 'Відділення або поштомат' }).fill('12');
  await page.getByRole('option', { name: 'Відділення №12' }).click();
  await page.getByRole('textbox', { name: 'Промокод' }).fill('WAND10');
  await page.getByRole('button', { name: 'Застосувати' }).click();
  await expect(page.getByText('Застосовано WAND10')).toBeVisible();
  await page.getByRole('button', { name: 'Оформити замовлення' }).click();
  await expect(page.getByRole('heading', { name: 'Замовлення прийнято' })).toBeVisible();
  await expect(page.getByText(/405\s*грн/)).toBeVisible();
  await page.getByRole('link', { name: 'Мої замовлення' }).click();
  await expect(page.getByText('Паличка Герміони / Бронза')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await expect.poll(async () => (await db.doc('promocodes/WAND10').get()).get('usageCount')).toBe(1);
  expect((await db.doc('products/wand-test').get()).get('stock')).toBe(1);
});

test('drafts stay private and backend enforces authorization, stock, promos, and retries', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'Android Chromium', 'Server integration only needs one browser project.');
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await page.getByLabel('Шаблон палички').selectOption({ label: 'Гаррі Поттер' });
  await page.getByRole('button', { name: 'Зберегти чернетку' }).click();
  await expect(page.getByText('Чернетку збережено.')).toBeVisible();
  const draft = (await db.collection('product_drafts').get()).docs[0];
  expect(draft.get('title')).toBe('Паличка Гаррі Поттера');
  expect((await db.doc('products/' + draft.id).get()).exists).toBe(false);
  const firestore = 'http://' + process.env.FIRESTORE_EMULATOR_HOST + '/v1/projects/demo-animeria/databases/(default)/documents/';
  expect((await request.get(firestore + 'product_drafts/' + draft.id)).status()).toBe(403);
  expect((await request.get(firestore + 'promocodes/WAND10')).status()).toBe(403);
  expect((await request.patch(firestore + 'orders/anonymous-order', { data: { fields: { totalPrice: { integerValue: '1' } } } })).status()).toBe(403);

  const buyer = signUser(888);
  const stranger = signUser(889);
  const unauthorized = await request.post('/api/notify_client', { data: { orderId: 'fake', status: 'shipped', initData: buyer } });
  expect(unauthorized.status()).toBe(401);
  expect((await request.post('/api/telegram_webhook', { data: {} })).status()).toBe(401);
  expect((await request.post('/api/checkout', { data: { action: 'quote', initData: buyer + 'x', items: [] } })).status()).toBe(401);

  const branches = await request.post('/api/np', { data: { action: 'branches', initData: buyer, query: '12', cityRef: CITY } });
  expect(branches.ok()).toBeTruthy();
  const { options } = await branches.json();
  const order = {
    action: 'place', deliveryProof: options[0].proof, firstName: 'Ada', lastName: 'Test', phone: '+380671234567',
    items: [{ id: 'wand-test', quantity: 1, color: 'Мідь', price: 1 }], promo: 'WAND10', key: randomUUID(), expectedTotal: 40_500,
  };
  expect((await request.post('/api/checkout', { data: { ...order, initData: stranger } })).status()).toBe(400);
  expect((await request.post('/api/checkout', { data: { ...order, expectedTotal: 1, initData: buyer } })).status()).toBe(409);

  const alternateKey = randomUUID();
  const results = await Promise.all([
    request.post('/api/checkout', { data: { ...order, initData: buyer } }),
    request.post('/api/checkout', { data: { ...order, key: alternateKey, initData: buyer } }),
  ]);
  expect(results.map(response => response.status()).sort()).toEqual([201, 409]);
  const winner = results.find(response => response.status() === 201)!;
  const { id, total } = await winner.json();
  const key = results[0].status() === 201 ? order.key : alternateKey;
  expect(total).toBe(40_500);
  expect((await request.post('/api/checkout', { data: { ...order, key, initData: buyer } })).status()).toBe(200);
  const recovered = await request.post('/api/checkout', { data: { action: 'status', key, initData: buyer } });
  expect((await recovered.json()).receipt).toEqual({ id, total });
  const inaccessible = await request.post('/api/checkout', { data: { action: 'status', key, initData: stranger } });
  expect((await inaccessible.json()).receipt).toBeNull();
  expect((await db.collection('orders').get()).size).toBe(1);
  expect((await db.doc('promocodes/WAND10').get()).get('usageCount')).toBe(1);
  const privateHistory = await request.post('/api/my_orders', { data: { initData: stranger, userId: 888 } });
  expect((await privateHistory.json()).orders).toEqual([]);
  expect((await request.post('/api/my_orders', { data: { initData: stranger, cursor: id } })).status()).toBe(400);

  await page.getByRole('button', { name: 'Замовлення', exact: true }).click();
  await page.getByRole('combobox', { name: 'Змінити статус' }).selectOption('processing');
  await page.getByRole('button', { name: 'Оновити статус' }).click();
  await expect(page.getByText(/Telegram: Forbidden: bot was blocked/)).toBeVisible();
  expect((await db.doc('orders/' + id).get()).get('status')).toBe('processing');
  await page.getByRole('combobox', { name: 'Змінити статус' }).selectOption('shipped');
  await page.getByRole('textbox', { name: 'ТТН' }).fill('20400012345678');
  await page.getByRole('button', { name: 'Оновити статус' }).click();
  await expect(page.getByText('ТТН 20400012345678')).toBeVisible();
  await page.getByRole('combobox', { name: 'Змінити статус' }).selectOption('completed');
  await page.getByRole('button', { name: 'Оновити статус' }).click();
  await expect.poll(async () => (await db.doc('orders/' + id).get()).get('status')).toBe('completed');
  const webhook = { update_id: 100, message: { text: '/review Чудова робота', from: { id: 888 }, chat: { id: 888, type: 'private' } } };
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': TEST_WEBHOOK_SECRET };
  expect((await request.post('/api/telegram_webhook', { data: webhook, headers })).ok()).toBeTruthy();
  expect((await request.post('/api/telegram_webhook', { data: webhook, headers })).ok()).toBeTruthy();
  expect((await db.collection('reviews').get()).size).toBe(1);

  const second = await request.post('/api/checkout', { data: { ...order, promo: '', expectedTotal: 45_000, key: randomUUID(), initData: buyer } });
  expect(second.status()).toBe(201);
  const { id: secondId } = await second.json();
  expect((await db.doc('products/wand-test').get()).get('stock')).toBe(0);
  await page.getByRole('combobox', { name: 'Змінити статус' }).selectOption('cancelled');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Оновити статус' }).click();
  await expect.poll(async () => (await db.doc('orders/' + secondId).get()).get('status')).toBe('cancelled');
  expect((await db.doc('products/wand-test').get()).get('stock')).toBe(1);
});

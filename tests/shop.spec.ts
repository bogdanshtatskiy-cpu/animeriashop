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
      colors: ['Мідь', 'Бронза', 'Графіт'], variantStock: { Мідь: 2, Бронза: 1, Графіт: 0 },
      packageContents: 'Паличка та захисне пакування', leadDays: 4,
      giftSet: { price: 150, contents: 'Паличка, підставка та коробка' }, imageUrls: ['/media/atelier.webp', '/logo.png'], featured: true, available: true,
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
  await expect(detail.getByText('До відправлення · до 4 дн.')).toBeVisible();
  await expect(detail.getByText('Паличка та захисне пакування')).toBeVisible();
  await detail.getByText('Графіт', { exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Недоступно' })).toBeDisabled();
  await detail.getByText('Бронза', { exact: true }).click();
  await expect(detail.getByText('У наявності · 1 шт.')).toBeVisible();
  await detail.getByRole('radio', { name: /Подарунковий набір/ }).check();
  const addItem = detail.getByRole('button', { name: 'Додати в кошик' });
  const scroller = detail.locator('.dialog-layout');
  const footerOffset = () => addItem.evaluate(node => node.getBoundingClientRect().top - node.closest('dialog')!.getBoundingClientRect().top);
  await scroller.evaluate(node => { node.scrollTop = 0; });
  const start = await footerOffset();
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(60);
  expect(Math.abs(await footerOffset() - start)).toBeLessThan(1);
  await expect(addItem).toBeInViewport();
  await expect(detail.locator('.detail-total').getByText(/600\s*грн/)).toBeVisible();
  await addItem.click();
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
  await expect(page.getByText(/540\s*грн/)).toBeVisible();
  await page.getByRole('link', { name: 'Мої замовлення' }).click();
  await expect(page.getByText('Паличка Герміони / Бронза · Подарунковий набір')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await expect.poll(async () => (await db.doc('promocodes/WAND10').get()).get('usageCount')).toBe(1);
  const remaining = await db.doc('products/wand-test').get();
  expect(remaining.get('stock')).toBe(1);
  expect(remaining.get('variantStock')).toMatchObject({ Бронза: 0, Мідь: 2 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const navigation = page.getByRole('navigation');
  await navigation.getByRole('link', { name: 'Обране' }).click();
  await expect(navigation.getByRole('link', { name: 'Обране' })).toHaveAttribute('aria-current', 'page');
  expect(await navigation.locator('.glass-lens').evaluate(node => parseFloat(getComputedStyle(node).animationDuration))).toBeLessThan(.001);
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
  expect((await db.doc('products/wand-test').get()).get('variantStock')).toMatchObject({ Мідь: 0 });
  await page.getByRole('combobox', { name: 'Змінити статус' }).selectOption('cancelled');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Оновити статус' }).click();
  await expect.poll(async () => (await db.doc('orders/' + secondId).get()).get('status')).toBe('cancelled');
  const remaining = await db.doc('products/wand-test').get();
  expect(remaining.get('stock')).toBe(1);
  expect(remaining.get('variantStock')).toMatchObject({ Бронза: 1, Мідь: 1 });
});

test('manual orders are private, idempotent, and support pickup and partial payment', async ({ page, request }) => {
  expect((await request.post('/api/admin_order', { data: {} })).status()).toBe(401);
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await page.getByRole('button', { name: 'Замовлення', exact: true }).click();
  await page.getByRole('button', { name: 'Додати замовлення' }).click();
  const form = page.getByRole('region', { name: 'Нове ручне замовлення' });
  await form.getByLabel('Ім’я та прізвище').fill('Олена Коваль');
  await form.getByLabel('Інший контакт').fill('@sample');
  await form.getByLabel('Виріб 1').fill('Паличка з ручним фарбуванням');
  await form.getByLabel('Ціна за шт., грн').fill('450');
  await form.getByRole('button', { name: 'Додати позицію' }).click();
  await form.getByLabel('Виріб 2').fill('Підставка');
  await form.getByLabel('Кількість').nth(1).fill('2');
  await form.getByLabel('Ціна за шт., грн').nth(1).fill('70.25');
  await form.getByLabel('Спосіб доставки').selectOption('pickup');
  await form.getByLabel('Адреса чи місце зустрічі').fill('Майстерня');
  await form.getByLabel('Уже отримано, грн').fill('100');
  await form.getByLabel('Примітки').fill('Матове покриття');
  const create = page.waitForRequest('**/api/admin_order');
  await form.getByRole('button', { name: 'Зберегти замовлення' }).click();
  const sent = await create;
  await expect(page.getByText(/Замовлення додано до активних/)).toBeVisible();
  const card = page.locator('.history-card');
  await expect(card.getByText('Олена Коваль')).toBeVisible();
  await expect(card.getByText('Threads · @sample')).toBeVisible();
  await expect(card.getByText(/Післяплата · До сплати 490,5/)).toBeVisible();
  await expect(card.getByText('Матове покриття')).toBeVisible();
  expect((await request.post('/api/admin_order', { headers: { Authorization: sent.headers().authorization }, data: sent.postDataJSON() })).status()).toBe(200);
  expect((await db.collection('orders').get()).size).toBe(1);
  const history = await request.post('/api/my_orders', { data: { initData: signUser(777) } });
  expect((await history.json()).orders).toEqual([]);
  await card.getByLabel('Змінити статус').selectOption('processing');
  await card.getByRole('button', { name: 'Оновити статус' }).click();
  await expect(card.getByText('У роботі')).toBeVisible();
  await card.getByLabel('Змінити статус').selectOption('shipped');
  await expect(card.getByLabel('ТТН')).toHaveCount(0);
  await card.getByRole('button', { name: 'Оновити статус' }).click();
  await expect(card.getByText('Відправлено')).toBeVisible();
  expect((await db.collection('orders').get()).docs[0].get('customerNotice')).toBeUndefined();
});

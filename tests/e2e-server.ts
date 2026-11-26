import { createServer } from 'vite';
import type { Plugin } from 'vite';
import checkout from '../api/checkout';
import favorites from '../api/favorites';
import orders from '../api/my_orders';
import notify from '../api/notify';
import notifyClient from '../api/notify_client';
import nova from '../api/np';
import webhook from '../api/telegram_webhook';
import type { ApiRequest, ApiResponse } from '../server/http';
import { BRANCH, CITY, TEST_TOKEN, TEST_WEBHOOK_SECRET } from './e2e-fixture';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Run this inside Firebase emulators.');
Object.assign(process.env, {
  VITE_FIREBASE_PROJECT_ID: 'demo-animeria',
  VITE_FIREBASE_API_KEY: 'local-demo-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-animeria.firebaseapp.com',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-animeria.appspot.com',
  VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  VITE_FIREBASE_AUTH_EMULATOR: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  TELEGRAM_BOT_TOKEN: TEST_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  ADMIN_TELEGRAM_ID: '1990',
  REVIEWS_CHANNEL_ID: '-1001',
  NOVA_POSHTA_API_KEY: 'demo-nova-key',
});

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (typeof input !== 'string') return realFetch(input, init);
  if (input.startsWith('https://api.telegram.org/')) {
    const message = JSON.parse(String(init?.body));
    return Number(message.chat_id) === 888
      ? Response.json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, { status: 403 })
      : Response.json({ ok: true });
  }
  if (input.startsWith('https://api.novaposhta.ua/')) {
    const { calledMethod } = JSON.parse(String(init?.body));
    return Response.json({ success: true, data: calledMethod === 'searchSettlements'
      ? [{ Addresses: [{ Present: 'Львів', DeliveryCity: CITY }] }]
      : [{ Ref: BRANCH, Description: 'Відділення №12', CityDescription: 'Львів' }] });
  }
  return realFetch(input, init);
};

const handlers = new Map([
  ['checkout', checkout], ['favorites', favorites], ['my_orders', orders], ['notify', notify],
  ['notify_client', notifyClient], ['np', nova], ['telegram_webhook', webhook],
]);

const apiPlugin: Plugin = {
  name: 'local-test-api',
  configureServer(vite) {
    vite.middlewares.use('/api', async (inbound, outbound, next) => {
      const handler = handlers.get(inbound.url?.split('?')[0].slice(1) ?? '');
      if (!handler) return next();
      const request = inbound as ApiRequest;
      const response = outbound as ApiResponse;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of inbound) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString('utf8');
        request.body = body ? JSON.parse(body) : null;
      } catch {
        outbound.statusCode = 400;
        outbound.end();
        return;
      }
      response.status = code => { response.statusCode = code; return response; };
      response.json = result => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); };
      await handler(request, response);
    });
  },
};

const vite = await createServer({ plugins: [apiPlugin], server: { host: '127.0.0.1', port: 3020 } });
await vite.listen();

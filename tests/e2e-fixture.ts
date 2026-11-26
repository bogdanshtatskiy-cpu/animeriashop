import { createHmac } from 'node:crypto';

export const TEST_TOKEN = '12345:test-token';
export const TEST_WEBHOOK_SECRET = 'animeria-local-webhook';
export const CITY = '11111111-1111-1111-1111-111111111111';
export const BRANCH = '22222222-2222-2222-2222-222222222222';
export function signUser(id: number, timestamp = Math.floor(Date.now() / 1000)) {
  const fields = new URLSearchParams({ auth_date: String(timestamp), user: JSON.stringify({ id, first_name: 'Ada', username: 'test_buyer' }) });
  fields.sort();
  const secret = createHmac('sha256', 'WebAppData').update(TEST_TOKEN).digest();
  fields.set('hash', createHmac('sha256', secret).update([...fields].map(([key, value]) => key + '=' + value).join('\n')).digest('hex'));
  return fields.toString();
}

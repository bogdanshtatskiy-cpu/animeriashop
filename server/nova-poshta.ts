import { createHmac } from 'node:crypto';
import { HttpError, requireField, stringField } from './http.js';
import { botToken, equalSecret } from './telegram.js';

export interface DeliveryPoint { cityRef: string; branchRef: string; city: string; branch: string }
export const novaRef = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const sign = (body: string) => createHmac('sha256', botToken()).update('nova-poshta:v1:' + body).digest('base64url');

export function deliveryProof(point: DeliveryPoint, userId: number) {
  const payload = Buffer.from(JSON.stringify({ ...point, userId, exp: Date.now() + 2 * 60 * 60 * 1000 })).toString('base64url');
  return payload + '.' + sign(payload);
}

export function verifyDelivery(input: unknown, userId: number): DeliveryPoint & { expiresAt: number } {
  const [payload, signature, extra] = stringField(input, 4000).split('.');
  const message = 'Оберіть місто й відділення Нової пошти ще раз.';
  requireField(payload && signature && !extra && equalSecret(sign(payload), signature), message, 'DELIVERY_EXPIRED');
  const { cityRef, branchRef, city, branch, exp, userId: owner } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  requireField(novaRef(cityRef) && novaRef(branchRef) && owner === userId && Number.isFinite(exp), message, 'DELIVERY_EXPIRED');
  return { cityRef, branchRef, city, branch, expiresAt: exp };
}

type NovaRow = Record<string, unknown>;
const cache = new Map<string, { expires: number; rows: Promise<NovaRow[]> }>();
const lookups = new Map<number, { expires: number; count: number }>();

export function limitNovaLookups(userId: number) {
  const now = Date.now();
  const current = lookups.get(userId);
  if (current && current.expires > now) {
    if (current.count >= 45) throw new HttpError(429, 'NOVA_LIMIT', 'Забагато запитів. Спробуйте за хвилину.');
    current.count++;
    return;
  }
  if (lookups.size >= 1000) lookups.delete(lookups.keys().next().value!);
  lookups.set(userId, { expires: now + 60_000, count: 1 });
}

export async function novaLookup(calledMethod: 'searchSettlements' | 'getWarehouses', methodProperties: Record<string, string>) {
  const apiKey = process.env.NOVA_POSHTA_API_KEY;
  if (!apiKey) throw new HttpError(503, 'NOVA_CONFIG', 'Пошук Нової пошти тимчасово недоступний.');
  const key = JSON.stringify({ calledMethod, methodProperties });
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.rows;
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const rows = (async () => {
    try {
      const response = await fetch('https://api.novaposhta.ua/v2.0/json/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(7000),
        body: JSON.stringify({ apiKey, modelName: 'Address', calledMethod, methodProperties }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.data)) throw new Error('Nova Poshta request failed');
      return data.data as NovaRow[];
    } catch {
      cache.delete(key);
      throw new HttpError(502, 'NOVA_UNAVAILABLE', 'Нова пошта не відповідає. Спробуйте ще раз.');
    }
  })();
  cache.set(key, { rows, expires: Date.now() + 5 * 60_000 });
  return rows;
}

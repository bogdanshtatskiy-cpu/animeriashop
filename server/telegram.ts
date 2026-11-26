import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

const MAX_SESSION_SECONDS = 60 * 60 * 24;
export interface TelegramUser { id: number; first_name?: string; username?: string }
export interface TelegramError {
  ok?: false;
  error_code?: number;
  description: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new HttpError(503, 'TELEGRAM_CONFIG', 'Сервіс Telegram тимчасово недоступний.');
  return token;
}

export function equalSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function telegramUser(initData: unknown, token = botToken(), now = Math.floor(Date.now() / 1000)): TelegramUser {
  const unauthorized = new HttpError(401, 'TELEGRAM_AUTH', 'Відкрийте магазин заново в Telegram.');
  if (typeof initData !== 'string' || initData.length > 12_000) throw unauthorized;
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== Array.from(params.keys()).length) throw unauthorized;
  const hash = params.get('hash');
  const timestamp = Number(params.get('auth_date'));
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(timestamp) || timestamp < now - MAX_SESSION_SECONDS || timestamp > now + 60) throw unauthorized;
  params.delete('hash');
  params.sort();
  const check = Array.from(params, ([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  if (!equalSecret(createHmac('sha256', secret).update(check).digest('hex'), hash)) throw unauthorized;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TelegramUser | null;
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw unauthorized;
    return user;
  } catch {
    throw unauthorized;
  }
}

export async function sendMessage(chatId: string | number, text: string): Promise<TelegramError | null> {
  const token = botToken();
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }), signal: AbortSignal.timeout(6500),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok === true) return null;
    const error: TelegramError = {
      ok: false,
      error_code: typeof data?.error_code === 'number' ? data.error_code : response.status,
      description: typeof data?.description === 'string' ? data.description : 'Telegram повернув некоректну відповідь.',
      ...(data?.parameters && typeof data.parameters === 'object' ? { parameters: data.parameters } : {}),
    };
    console.error('Telegram sendMessage rejected', { error_code: error.error_code, description: error.description });
    return error;
  } catch {
    return { description: 'Telegram не відповів. Спробуйте ще раз.' };
  }
}

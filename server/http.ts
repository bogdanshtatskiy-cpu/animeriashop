import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiRequest extends IncomingMessage { body: unknown }
export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(data: unknown): void;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function requireField(condition: unknown, message: string, code = 'INVALID_INPUT'): asserts condition {
  if (!condition) throw new HttpError(400, code, message);
}

export function record(input: unknown): Record<string, unknown> {
  requireField(input && typeof input === 'object' && !Array.isArray(input), 'Некоректні дані запиту.');
  return input as Record<string, unknown>;
}

export function stringField(input: unknown, max: number) {
  requireField(typeof input === 'string' && input.length <= max, 'Некоректне або задовге поле.');
  return input.trim();
}

export function documentId(input: unknown) {
  const id = stringField(input, 128);
  requireField(/^[\p{L}\p{N}._-]+$/u.test(id) && id !== '.' && id !== '..', 'Некоректний ідентифікатор.');
  return id;
}

export function post(handler: (req: ApiRequest, res: ApiResponse, body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: ApiRequest, res: ApiResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Дозволено лише POST.' });
    }
    try {
      const length = Number(req.headers['content-length'] ?? 0);
      if (length > 64_000) throw new HttpError(413, 'TOO_LARGE', 'Запит завеликий.');
      if (!req.headers['content-type']?.startsWith('application/json')) {
        throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Очікується JSON.');
      }
      return await handler(req, res, record(req.body));
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error('Request failed', { path: req.url?.split('?')[0], type: error instanceof Error ? error.name : 'Unknown' });
      return res.status(500).json({ error: 'Тимчасова помилка сервера. Спробуйте ще раз.' });
    }
  };
}

import { telegram } from './telegram';

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

export async function api<T>(path: string, body: object, options?: { signal?: AbortSignal; token?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.token) headers.Authorization = 'Bearer ' + options.token;
  const response = await fetch('/api/' + path, {
    method: 'POST', headers, signal: options?.signal,
    body: JSON.stringify({ ...body, ...(options?.token ? {} : { initData: telegram()?.initData }) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new ApiError(data?.telegram?.description || data?.error || 'Не вдалося виконати запит. Спробуйте ще раз.', data?.code);
  return data as T;
}

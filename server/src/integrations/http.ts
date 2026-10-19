/** 바깥 API 호출. 응답이 2xx가 아니면 본문을 담아 던진다. */
export class ExternalApiError extends Error {
  constructor(readonly service: string, readonly status: number, readonly body: any) {
    super(`${service} ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
}

export async function callJson<T = any>(
  service: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | undefined;
  if (init.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  } else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
  });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* 본문이 JSON이 아님 */ }
  if (!res.ok) throw new ExternalApiError(service, res.status, data);
  return data as T;
}

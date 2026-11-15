export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const rawApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
export const API_BASE_URL = rawApiBase.replace(/\/+$/, '');

export function buildApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const targetUrl = buildApiUrl(url);
  const res = await fetch(targetUrl, {
    ...options,
    headers,
    credentials: 'include',
    mode: API_BASE_URL ? 'cors' : options.mode,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : res.status === 405
          ? `Método HTTP não permitido (405) em ${targetUrl}. Verifique se o Cloudflare Worker está associado à rota /api/*.`
          : `Erro no servidor (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

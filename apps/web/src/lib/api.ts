const BASE_URL = '/api/';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('qaforge_token');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      ...(opts.body !== undefined && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });

  if (res.status === 401) {
    const onAuthPage = ['/login', '/register'].includes(window.location.pathname);
    if (!onAuthPage) {
      localStorage.removeItem('qaforge_token');
      window.location.href = '/login';
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }
    // On the login page, fall through to normal error handling so the
    // API's "Invalid credentials" message is shown rather than "Session expired"
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get:    <T>(path: string)                => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT',   body: body ? JSON.stringify(body) : undefined }),
  patch:  <T>(path: string, body: unknown)  => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string)                => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

export { ApiError };

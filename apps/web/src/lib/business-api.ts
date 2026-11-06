import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function businessApiFetch(path: string, options: RequestInit = {}) {
  let sessionToken: string | null = null;

  if (typeof window === 'undefined') {
    const cookieStore = await cookies();
    const token = cookieStore.get('business_session')?.value;
    if (token) {
      sessionToken = token;
    }
  }

  const headers = new Headers(options.headers || {});
  
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
  };

  if (typeof window !== 'undefined') {
    fetchOptions.credentials = 'include';
  }

  const response = await fetch(`${API_URL}${path}`, fetchOptions);

  return response;
}

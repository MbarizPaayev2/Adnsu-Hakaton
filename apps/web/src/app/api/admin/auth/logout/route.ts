import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rejectCrossSite } from '@/lib/admin-origin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin_session')?.value;

    if (token) {
      await fetch(`${API_URL}/admin/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      cookieStore.delete('admin_session');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: true }); // Ignore error and logout anyway
  }
}

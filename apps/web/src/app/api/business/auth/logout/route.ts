import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('business_session')?.value;

    if (token) {
      await fetch(`${API_URL}/business/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      cookieStore.delete('business_session');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: true }); // Ignore error and logout anyway
  }
}

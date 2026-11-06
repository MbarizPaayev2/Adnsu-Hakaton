'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { PostHogProvider } from './posthog-provider';
import { NoticeHost } from './notice-host';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PostHogProvider>
        {children}
        <NoticeHost />
      </PostHogProvider>
    </SessionProvider>
  );
}

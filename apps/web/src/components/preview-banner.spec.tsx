import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewBanner, previewBannerVisible } from './preview-banner';

afterEach(() => vi.unstubAllEnvs());

describe('PreviewBanner', () => {
  it('says what is synthetic on a local host when the preview launcher asks for it', () => {
    vi.stubEnv('NEXT_PUBLIC_PREVIEW_BANNER', 'synthetic');
    render(<PreviewBanner />);
    expect(screen.getByTestId('preview-banner').textContent).toMatch(/dil modeli deyil/);
  });

  it('never shows without the launcher switch, and never on a public host', () => {
    expect(previewBannerVisible('localhost')).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_PREVIEW_BANNER', 'synthetic');
    expect(previewBannerVisible('127.0.0.1')).toBe(true);
    expect(previewBannerVisible('aisehr.com')).toBe(false);
  });

  it('is never shown by a production build', () => {
    vi.stubEnv('NEXT_PUBLIC_PREVIEW_BANNER', 'synthetic');
    vi.stubEnv('NODE_ENV', 'production');
    expect(previewBannerVisible('localhost')).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => ({ sessionToken: 'tok' })) }));
import { proxy } from './proxy';

describe('dashboard onboarding gate', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.mocked(getToken).mockResolvedValue({ sessionToken: 'tok' }); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });
  const profile = (done: boolean) => new Response(JSON.stringify({ onboardingCompletedAt: done ? '2026-10-12T00:00:00Z' : null }), { status: 200 });

  it('sends a not-yet-onboarded candidate to the wizard and keeps the checkout return marker so the plan can be confirmed there', async () => {
    fetchMock.mockResolvedValue(profile(false));
    const res = await proxy(new NextRequest('http://localhost/dashboard?checkout=success'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/dashboard/profile');
    expect(loc.searchParams.get('onboarding')).toBe('true');
    expect(loc.searchParams.get('checkout')).toBe('success');
  });

  it('adds nothing to an ordinary redirect, and lets an onboarded candidate through', async () => {
    fetchMock.mockResolvedValue(profile(false));
    const plain = await proxy(new NextRequest('http://localhost/dashboard/resumes'));
    const plainLoc = new URL(plain.headers.get('location')!);
    expect(plainLoc.searchParams.get('onboarding')).toBe('true');
    expect(plainLoc.searchParams.get('checkout')).toBeNull();
    expect(plainLoc.searchParams.get('from')).toBe('/dashboard/resumes');
    fetchMock.mockResolvedValue(profile(true));
    const ok = await proxy(new NextRequest('http://localhost/dashboard?checkout=success'));
    expect(ok.headers.get('location')).toBeNull();
  });

  it('never sends a candidate to the wizard for settings, notifications or the tracker', async () => {
    fetchMock.mockResolvedValue(profile(false));
    for (const path of ['/dashboard/settings', '/dashboard/notifications', '/dashboard/applications/tracker']) {
      const res = await proxy(new NextRequest(`http://localhost${path}`));
      expect(res.headers.get('location')).toBeNull();
    }
    const gated = await proxy(new NextRequest('http://localhost/dashboard/applications'));
    expect(new URL(gated.headers.get('location')!).pathname).toBe('/dashboard/profile');
  });
});

describe("canonical Chrome/Safari origin and onboarding gate", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  it.each([
    "/login?next=%2Fdashboard",
    "/forgot-password",
    "/dashboard/saved?x=1",
    "/jobs?q=analyst",
  ])("redirects www before reading a session: %s", async (path) => {
    const r = await proxy(new NextRequest(`https://www.aisehr.com${path}`));
    expect(r.status).toBe(308);
    expect(r.headers.get("location")).toBe(`https://aisehr.com${path}`);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [{ host: "www.aisehr.com" }],
    [{ host: "localhost:3000", "x-forwarded-host": "www.aisehr.com" }],
    [{ host: "WWW.AISEHR.COM:443" }],
  ])("redirects www as the standalone server sees it (URL on its own address, host in headers): %o", async (headers) => {
    const r = await proxy(new NextRequest("http://localhost:3000/forgot-password?x=1", { headers }));
    expect(r.status).toBe(308);
    expect(r.headers.get("location")).toBe("https://aisehr.com/forgot-password?x=1");
  });
  it("does not redirect the root host or the Apple Pay file seen through headers", async () => {
    expect((await proxy(new NextRequest("http://localhost:3000/login", { headers: { host: "aisehr.com" } }))).headers.get("location")).toBeNull();
    expect((await proxy(new NextRequest("http://localhost:3000/.well-known/apple-developer-merchantid-domain-association", { headers: { host: "www.aisehr.com" } }))).headers.get("location")).toBeNull();
  });
  it("leaves Apple Pay verification on www and public pages on the root host alone", async () => {
    expect(
      (
        await proxy(
          new NextRequest(
            "https://www.aisehr.com/.well-known/apple-developer-merchantid-domain-association",
          ),
        )
      ).headers.get("location"),
    ).toBeNull();
    expect(
      (await proxy(new NextRequest("https://aisehr.com/login"))).headers.get(
        "location",
      ),
    ).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });
  it("preserves the verified-payment return through an incomplete onboarding redirect", async () => {
    vi.mocked(getToken).mockResolvedValue({ sessionToken: "synthetic" });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ onboardingCompletedAt: null })),
    );
    const r = await proxy(
      new NextRequest("https://aisehr.com/dashboard?checkout=success"),
    );
    expect(r.headers.get("location")).toBe(
      "https://aisehr.com/dashboard/profile?onboarding=true&checkout=success",
    );
  });

  it("consistently canonicalizes uppercase blog slugs and aliases before SSR with a single 308 redirect", async () => {
    for (const alias of ["ATS-UYGUN-CV", "ats-cv", "ats-e-uygun-cv"]) {
      const r = await proxy(new NextRequest(`https://aisehr.com/blog/${alias}`));
      expect(r.status).toBe(308);
      expect(r.headers.get("location")).toBe("https://aisehr.com/blog/ats-uygun-cv");
    }

    // Canonical slug passes through without redirect
    const canonical = await proxy(new NextRequest("https://aisehr.com/blog/ats-uygun-cv"));
    expect(canonical.headers.get("location")).toBeNull();

    // Subresource routes pass through without redirect
    const image = await proxy(new NextRequest("https://aisehr.com/blog/ats-uygun-cv/opengraph-image"));
    expect(image.headers.get("location")).toBeNull();
  });
});

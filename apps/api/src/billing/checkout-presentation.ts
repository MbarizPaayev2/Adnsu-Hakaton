/**
 * How a checkout session looks and which payment methods it offers, shared by the candidate and employer sessions.
 *
 * AISE embeds the provider's checkout page (inline SDK) instead of redirecting. The session is still created on the server from an approved product,
 * so the browser never holds a price, a product id or an API key. The wallets are named explicitly as the provider documents; whether Apple Pay or
 * Google Pay is actually shown still depends on the device, the browser, the currency and (Apple Pay, embedded) the registered domain, which is
 * decided by the provider's page, not here.
 */
export const CHECKOUT_PRESENTATION = {
  customization: { theme: 'light' as const, force_language: 'az' },
  allowed_payment_method_types: ['credit', 'debit', 'apple_pay', 'google_pay'] as Array<'credit' | 'debit' | 'apple_pay' | 'google_pay'>,
};

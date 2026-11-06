import type { EmailDeliveryState } from '@prisma/client';

/** The one feature key that carries the limit. The numbers live in packages/shared-types product-spec (operator overrides: PRODUCT_CONFIG_JSON). */
export const EMAIL_FEATURE = 'email.applications';

/**
 * States in which an approved application holds one unit of the monthly allowance. The unit is held from approval (QUEUED) until the send
 * definitively fails: FAILED, BOUNCED (the recipient's server refused it) and CANCELLED (never sent) give it back. UNCERTAIN keeps it (the message may
 * have gone out) and, because a retry reuses the same row, resolving it never costs a second unit.
 */
export const HOLDING_STATES: readonly EmailDeliveryState[] = ['QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'UNCERTAIN', 'COMPLAINED'];

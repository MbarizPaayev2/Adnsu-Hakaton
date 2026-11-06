# Employer billing: what is watched and how to trace the first purchase (11 October 2026)

`scripts/check-health.sh` (cron, every 15 minutes, read-only) now has an **employer billing** section. It raises an alert for:

| Alert | Meaning | Threshold |
|---|---|---|
| `paid_no_credit` | a purchase is `PAID` and no listing credit exists: the customer paid and cannot publish | 10 minutes after payment |
| `refund_stuck` | `REFUND_PENDING` with no provider confirmation | 24 hours |
| `paid_unused` | a credit paid for and never used: the employer may be stuck behind the review queue | 7 days |
| `event_unprocessed` | a provider event was received and not processed | 30 minutes |

Otherwise one OK line reports the counts (paid / refunded / active Business).

## Tracing the first real purchase
On the production host, after the employer pays:

```bash
cd /srv/stacks/aise && scripts/employer-trace.sh "<company name fragment, company id or purchase id>"
```

The whole path is: purchase `PAID` (amount **20.00 AZN**, paid time) → credit `AVAILABLE` → employer publishes → credit `CONSUMED` by a vacancy that is `ACTIVE` with `plan SINGLE`, a publication time and an expiry 30 days later. A Business purchase shows as an `active` subscription with its period end and the number of `ACTIVE` BUSINESS listings. The last provider events (type, outcome, processed or not) are listed below.

Nothing is changed by either script. No live charge is created to test them; against production today they report zero purchases.

Admin view: `/admin/employer-purchases` (refunds need MFA and the `payments.refund` permission).

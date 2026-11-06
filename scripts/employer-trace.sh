#!/usr/bin/env bash
#
# Read-only trace of one employer purchase from payment to publication. Prints, for each match: the purchase (amount in AZN, status, times), the listing credit it
# created (AVAILABLE / CONSUMED / VOIDED), the vacancy that spent it (status, plan, publication and expiry), the company's Business subscription, and the last
# provider events. No secret and no personal data other than the company name is printed.
#
#   scripts/employer-trace.sh <purchase id | company id | company-name fragment>     # run on the production host
#
# Run it after the FIRST real purchase: PAID with a credit, the credit CONSUMED by an ACTIVE vacancy, is the whole path. It changes nothing.
set -uo pipefail
Q="${1:?usage: employer-trace.sh <purchase id | company id | company-name fragment>}"
DOCKER="${DOCKER:-docker}"; PG="${POSTGRES_CONTAINER:-aise-postgres}"
run() { "$DOCKER" exec -i "$PG" psql -U postgres -d aise -v "q=$Q" -P pager=off -P footer=off -X "$@"; }
echo "== purchases"
run <<'SQL'
select p.id as purchase, co.name as company, p.kind, to_char(p."amountMinor" / 100.0, 'FM9990.00') || ' ' || p.currency as amount, p.status,
       to_char(p."createdAt", 'MM-DD HH24:MI') as created, to_char(p."paidAt", 'MM-DD HH24:MI') as paid, to_char(p."refundedAt", 'MM-DD HH24:MI') as refunded,
       c.status as credit, to_char(c."consumedAt", 'MM-DD HH24:MI') as spent, v.title as vacancy, v.status as vacancy_status, v."publicationPlan" as plan,
       to_char(v."publishedAt", 'MM-DD HH24:MI') as published, to_char(v."expiresAt", 'MM-DD HH24:MI') as expires
from "EmployerPurchase" p
join "Company" co on co.id = p."companyId"
left join "EmployerCredit" c on c."purchaseId" = p.id
left join "Vacancy" v on v.id = c."consumedVacancyId"
where p.id = :'q' or co.id = :'q' or co.name ilike '%' || :'q' || '%'
order by p."createdAt" desc limit 10;
SQL
echo "== Business subscription"
run <<'SQL'
select co.name as company, s.status, to_char(s."currentPeriodEnd", 'YYYY-MM-DD HH24:MI') as period_end, s."cancelAtPeriodEnd" as cancels,
       to_char(s."providerSyncedAt", 'MM-DD HH24:MI') as synced,
       (select count(*) from "Vacancy" v where v."companyId" = co.id and v.status = 'ACTIVE' and v."publicationPlan" = 'BUSINESS') as active_business_listings
from "EmployerSubscription" s join "Company" co on co.id = s."companyId"
where co.id = :'q' or co.name ilike '%' || :'q' || '%' or s."companyId" in (select "companyId" from "EmployerPurchase" where id = :'q');
SQL
echo "== last billing events (all companies)"
run <<'SQL'
select to_char("receivedAt", 'MM-DD HH24:MI') as received, type, coalesce(outcome, '-') as outcome, case when "processedAt" is null then 'NOT PROCESSED' else 'processed' end as state
from "BillingWebhookEvent" order by "receivedAt" desc limit 8;
SQL

-- Read-only document generation baseline: outcomes, latency, provider calls and translation completeness of recent documents.
-- Codes, counts and durations only (no CV, letter or vacancy text is selected):
--   docker compose exec -T postgres psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f - < scripts/document-quality-baseline.sql
BEGIN TRANSACTION READ ONLY;

\echo '== document runs, last 14 days, by kind and result'
SELECT "docKind", result, "errorCode", COUNT(*) AS runs,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY "generationMs") AS gen_p50_ms,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY "generationMs") AS gen_p90_ms,
       MAX("generationMs") AS gen_max_ms,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY "queueMs") AS queue_p50_ms,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY "renderMs") AS render_p50_ms,
       ROUND(AVG(calls), 1) AS avg_calls
FROM "DocumentRun" WHERE "createdAt" >= now() - interval '14 days'
GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC;

\echo '== provider calls, last 14 days, by stage, provider, model and outcome'
SELECT stage, provider, model, outcome, "httpStatus", COUNT(*) AS calls,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50_ms,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY "latencyMs") AS p90_ms,
       SUM("inputTokens") AS input_tokens, SUM("outputTokens") AS output_tokens,
       COUNT(*) FILTER (WHERE "inputTokens" IS NULL) AS calls_without_usage
FROM "AiUsageEvent" WHERE "createdAt" >= now() - interval '14 days'
GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 6 DESC;

\echo '== Azerbaijani documents, last 14 days: status and fields still English (not_translated notes)'
WITH docs AS (
  SELECT r.id, r."docKind", r.status, r."createdAt",
         (r."generationMeta"->>'latencyMs')::int AS latency_ms,
         (r."generationMeta"->>'calls')::int AS calls,
         COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."reviewNotes"->'issues') = 'array' THEN r."reviewNotes"->'issues' ELSE '[]'::jsonb END) i WHERE i->>'code' = 'not_translated'), 0) AS not_translated,
         COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."reviewNotes"->'issues') = 'array' THEN r."reviewNotes"->'issues' ELSE '[]'::jsonb END) i WHERE i->>'code' = 'translated'), 0) AS translated,
         (SELECT string_agg(o, ' ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r."generationMeta"->'outcomes') = 'array' THEN r."generationMeta"->'outcomes' ELSE '[]'::jsonb END) o WHERE o LIKE 'translate:%' AND o NOT LIKE 'translate:%:%-accepted:%') AS translate_outcomes
  FROM "Resume" r
  WHERE r."isBase" = false AND r.language = 'az' AND r."createdAt" >= now() - interval '14 days'
)
SELECT "docKind", status, COUNT(*) AS documents,
       COUNT(*) FILTER (WHERE not_translated > 0) AS with_english_left,
       SUM(not_translated) AS english_fields, SUM(translated) AS translated_fields,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS latency_p50_ms,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY latency_ms) AS latency_p90_ms,
       ROUND(AVG(calls), 1) AS avg_calls
FROM docs GROUP BY 1, 2 ORDER BY 1, 3 DESC;

\echo '== Azerbaijani documents with English left: translation outcome codes (newest 30)'
SELECT r.id, r."docKind", r.status, r."createdAt",
       (r."generationMeta"->>'latencyMs')::int AS latency_ms,
       (SELECT string_agg(o, ' ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r."generationMeta"->'outcomes') = 'array' THEN r."generationMeta"->'outcomes' ELSE '[]'::jsonb END) o WHERE o LIKE 'translate%' OR o LIKE 'writer%' OR o LIKE 'polish%') AS outcomes,
       (SELECT string_agg(DISTINCT i->>'section', ' | ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."reviewNotes"->'issues') = 'array' THEN r."reviewNotes"->'issues' ELSE '[]'::jsonb END) i WHERE i->>'code' = 'not_translated') IS NOT NULL AS has_sections,
       (SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."reviewNotes"->'issues') = 'array' THEN r."reviewNotes"->'issues' ELSE '[]'::jsonb END) i WHERE i->>'code' = 'not_translated') AS english_fields
FROM "Resume" r
WHERE r."isBase" = false AND r.language = 'az' AND r."createdAt" >= now() - interval '14 days'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."reviewNotes"->'issues') = 'array' THEN r."reviewNotes"->'issues' ELSE '[]'::jsonb END) i WHERE i->>'code' = 'not_translated')
ORDER BY r."createdAt" DESC LIMIT 30;

\echo '== failed Azerbaijani documents by error (status FAILED), last 14 days'
SELECT "docKind", left("statusError", 120) AS error, COUNT(*) FROM "Resume"
WHERE "isBase" = false AND language = 'az' AND status = 'FAILED' AND "createdAt" >= now() - interval '14 days'
GROUP BY 1, 2 ORDER BY 3 DESC;

COMMIT;

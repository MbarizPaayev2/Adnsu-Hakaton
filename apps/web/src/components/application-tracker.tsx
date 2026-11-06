"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, downloadAuthedFile } from "@/lib/api";

interface Column {
  id: string;
  name: string;
  hidden?: boolean;
}

interface Row {
  key: string;
  title: string;
  company: string;
  url: string;
  date: string;
  stage: string;
  notes: string;
  custom: Record<string, string>;
  source: string;
  evidence: string;
  hidden: boolean;
}

interface Data {
  columns: Column[];
  rows: Row[];
  total: number;
  page: number;
  pages: number;
}

const STAGES: Record<string, string> = {
  PLANNED: "Hazırlanır",
  APPLIED: "Müraciət edilib",
  INTERVIEW: "Müsahibə",
  OFFER: "Təklif",
  HIRED: "İşə qəbul",
  REJECTED: "İmtina",
  WITHDRAWN: "Geri götürülüb",
};

const ACTIVE_STAGES = ["PLANNED", "APPLIED", "INTERVIEW", "OFFER"];
const CLOSED_STAGES = ["HIRED", "REJECTED", "WITHDRAWN"];

const STAGE_STYLES: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  PLANNED: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-900 dark:text-amber-200",
    border: "border-amber-300 dark:border-amber-700",
    badge: "bg-amber-100 text-amber-900 border-amber-300",
  },
  APPLIED: {
    bg: "bg-sky-50 dark:bg-sky-950/30",
    text: "text-sky-900 dark:text-sky-200",
    border: "border-sky-300 dark:border-sky-700",
    badge: "bg-sky-100 text-sky-900 border-sky-300",
  },
  INTERVIEW: {
    bg: "bg-purple-50 dark:bg-purple-950/30",
    text: "text-purple-900 dark:text-purple-200",
    border: "border-purple-300 dark:border-purple-700",
    badge: "bg-purple-100 text-purple-900 border-purple-300",
  },
  OFFER: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-900 dark:text-emerald-200",
    border: "border-emerald-300 dark:border-emerald-700",
    badge: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  HIRED: {
    bg: "bg-green-100 dark:bg-green-950/40",
    text: "text-green-950 dark:text-green-100",
    border: "border-green-400 dark:border-green-600",
    badge: "bg-green-200 text-green-950 border-green-400",
  },
  REJECTED: {
    bg: "bg-rose-50 dark:bg-rose-950/30",
    text: "text-rose-900 dark:text-rose-200",
    border: "border-rose-300 dark:border-rose-700",
    badge: "bg-rose-100 text-rose-900 border-rose-300",
  },
  WITHDRAWN: {
    bg: "bg-neutral-100 dark:bg-neutral-800",
    text: "text-neutral-700 dark:text-neutral-300",
    border: "border-neutral-300 dark:border-neutral-600",
    badge: "bg-neutral-200 text-neutral-800 border-neutral-300",
  },
};

const EVIDENCE: Record<string, string> = {
  DRAFT: "Qaralama",
  APPROVED: "Təsdiqlənib",
  PROVIDER_ACCEPTED: "Poçt xidməti qəbul edib",
  DELIVERED: "Çatdırılıb",
  REPLY_RECEIVED: "Cavab gəlib",
  IN_REVIEW: "Baxılır",
  INTERVIEW: "Müsahibə qeydə alınıb",
  OFFER: "Təklif qeydə alınıb",
  HIRED: "İşə qəbul qeydə alınıb",
  CANDIDATE_REPORTED: "Öz qeydiniz",
  DRY_RUN: "Sınaq · göndərilməyib",
  FAILED: "Göndəriş uğursuzdur",
  UNCERTAIN: "Çatdırılma bəlli deyil",
  BOUNCED: "Geri qayıdıb",
  COMPLAINED: "Şikayət",
  CANCELLED: "Ləğv edilib",
  REJECTED: "İmtina",
  WITHDRAWN: "Geri götürülüb",
  UNCONFIRMED: "Qəbul təsdiqlənməyib",
  EXPIRED: "Vaxtı bitib",
};

const EVIDENCE_INDICATORS: Record<string, { dot: string; title: string }> = {
  DELIVERED: { dot: "bg-emerald-500", title: "Sistem sübutu: poçt serverinə çatdırıldı" },
  PROVIDER_ACCEPTED: { dot: "bg-blue-500", title: "Sistem sübutu: poçt xidməti göndərişi qəbul etdi" },
  REPLY_RECEIVED: { dot: "bg-purple-500", title: "Sistem sübutu: işəgötürəndən cavab daxil oldu" },
  IN_REVIEW: { dot: "bg-sky-500", title: "Sistem sübutu: vakansiya nəzərdən keçirilir" },
  DRAFT: { dot: "bg-amber-400", title: "Qaralama vəziyyətindədir" },
  CANDIDATE_REPORTED: { dot: "bg-neutral-400", title: "Şəxsi qeyd: xarici sistem təsdiqi yoxdur" },
  DRY_RUN: { dot: "bg-amber-500", title: "Sınaq rejimi: faktiki göndəriş icra olunmayıb" },
  FAILED: { dot: "bg-rose-500", title: "Sistem sübutu: göndəriş baş tutmadı" },
  BOUNCED: { dot: "bg-rose-500", title: "Sistem sübutu: e-poçt ünvanı mövcud deyil" },
};

const SOURCES: Record<string, string> = {
  email: "AISE e-poçt",
  native: "AISE vakansiya",
  external: "Xarici portal",
  browser: "Brauzer köməkçisi",
  manual: "Öz qeydim",
  reported: "Özüm müraciət etmişəm",
};

const nextActionFor = (stage: string, evidence: string): string => {
  if (stage === "PLANNED") return "Müraciəti tamamlayın";
  if (stage === "APPLIED") {
    if (evidence === "DELIVERED") return "Cavab gözlənilir";
    if (evidence === "PROVIDER_ACCEPTED") return "Çatdırılma yoxlanılır";
    if (evidence === "FAILED" || evidence === "BOUNCED") return "Ünvanı dəqiqləşdirin";
    return "Nəticə izlənilir";
  }
  if (stage === "INTERVIEW") return "Müsahibəyə hazırlaşın";
  if (stage === "OFFER") return "Təklifi dəyərləndirin";
  if (stage === "HIRED") return "Uğurlar!";
  if (stage === "REJECTED") return "Arxivləşdirilib";
  if (stage === "WITHDRAWN") return "Geri götürülüb";
  return "Növbəti addım yoxdur";
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors";
const BUTTON =
  "min-h-11 rounded-xl border border-neutral-dark/25 px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-neutral-dark/5 transition-colors cursor-pointer";
const PRIMARY_BUTTON =
  "min-h-11 rounded-xl bg-primary text-white hover:bg-primary-hover px-5 py-2.5 text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2";

export function ApplicationTracker() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "active" | "closed">("all");
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newStage, setNewStage] = useState("APPLIED");
  const [newNotes, setNewNotes] = useState("");
  const [columnName, setColumnName] = useState("");
  const [showColumnsConfig, setShowColumnsConfig] = useState(false);

  const failedEdits = useRef(
    new Map<string, { row: Row; fields: Record<string, unknown> }>(),
  );

  const load = useCallback(async () => {
    if (failedEdits.current.size) return;
    setError("");
    try {
      const params = new URLSearchParams({
        q: search,
        stage,
        group: quickFilter !== "all" ? quickFilter : "",
        page: String(page),
        hidden: String(hidden),
      });
      const r = await apiFetch(`/application-tracker?${params}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setError("Cədvəl yüklənmədi. Yenidən cəhd edin.");
    }
  }, [search, stage, quickFilter, page, hidden]);

  useEffect(() => {
    void load();
  }, [load]);

  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const noticeTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (
        !pending.current &&
        !adding &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName ?? "",
        )
      )
        void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load, adding]);

  function patch(row: Row, fields: Record<string, unknown>) {
    const editKey = `${row.key}:${Object.keys(fields).join(",")}:${Object.keys((fields.custom ?? {}) as object).join(",")}`;
    pending.current++;
    setBusy(true);
    setNotice("Saxlanılır…");
    if (noticeTimeout.current) clearTimeout(noticeTimeout.current);

    queue.current = queue.current.then(async () => {
      try {
        const r = await apiFetch(
          `/application-tracker/${encodeURIComponent(row.key)}`,
          { method: "PATCH", body: JSON.stringify(fields) },
        );
        if (!r.ok) {
          const errData = await r.json().catch(() => null);
          throw new Error(errData?.message || "Son dəyişiklik saxlanılmadı. Yenidən saxlayın.");
        }
        setData((d) =>
          d
            ? {
                ...d,
                rows: d.rows.map((r) =>
                  r.key === row.key
                    ? ({
                        ...r,
                        ...fields,
                        custom: {
                          ...r.custom,
                          ...(fields.custom as Record<string, string> | undefined),
                        },
                      } as Row)
                    : r,
                ),
              }
            : d,
        );
        failedEdits.current.delete(editKey);
        if (!failedEdits.current.size) setError("");
        setNotice("Saxlanıldı.");
        noticeTimeout.current = setTimeout(() => {
          setNotice((n) => (n === "Saxlanıldı." ? "" : n));
        }, 2500);
        if (Object.hasOwn(fields, "hidden")) await load();
      } catch (err: any) {
        failedEdits.current.set(editKey, { row, fields });
        setNotice("");
        const msg = err?.message && typeof err.message === "string" ? err.message : "";
        setError(
          msg.includes("saxlanılmadı")
            ? msg
            : msg && !msg.includes("fetch") && !msg.includes("Failed")
              ? `${msg} — dəyişiklik saxlanılmadı.`
              : "Son dəyişiklik saxlanılmadı. Yenidən saxlayın.",
        );
      } finally {
        pending.current--;
        if (!pending.current) setBusy(false);
      }
    });
  }

  async function columns(next: Column[]) {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch("/application-tracker/columns", {
        method: "PUT",
        body: JSON.stringify({ columns: next }),
      });
      if (!r.ok) throw new Error();
      setData((d) => (d ? { ...d, columns: next } : d));
      setNotice("Sütunlar saxlanıldı.");
      setTimeout(() => setNotice((n) => (n === "Sütunlar saxlanıldı." ? "" : n)), 2500);
    } catch {
      setError("Sütunlar saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }

  const handleTabChange = (next: "all" | "active" | "closed") => {
    setQuickFilter(next);
    setPage(1);
    if (next === "all") {
      setStage("");
    } else if (next === "active" && stage && !ACTIVE_STAGES.includes(stage)) {
      setStage("");
    } else if (next === "closed" && stage && !CLOSED_STAGES.includes(stage)) {
      setStage("");
    }
  };

  const handleStageChange = (nextStage: string) => {
    setStage(nextStage);
    setPage(1);
    if (nextStage) {
      if (ACTIVE_STAGES.includes(nextStage)) {
        setQuickFilter("active");
      } else if (CLOSED_STAGES.includes(nextStage)) {
        setQuickFilter("closed");
      }
    }
  };

  const displayedRows = data?.rows ?? [];

  const cell = (
    row: Row,
    key: "title" | "company" | "url" | "date" | "notes",
  ) => (
    <input
      aria-label={`${STAGES[row.stage] ?? row.stage}: ${key}`}
      className={`${INPUT} ${key === "notes" ? "w-full" : "w-full min-w-36"}`}
      type={key === "date" ? "date" : key === "url" ? "url" : "text"}
      defaultValue={row[key]}
      onFocus={(e) => {
        e.currentTarget.dataset.beforeEdit = e.currentTarget.value;
      }}
      maxLength={key === "notes" ? 5000 : key === "url" ? 2000 : 300}
      onBlur={(e) => {
        if (e.target.value !== (e.currentTarget.dataset.beforeEdit ?? row[key]))
          patch(row, { [key]: e.target.value });
      }}
    />
  );

  return (
    <main className="space-y-6 max-w-full min-w-0 pb-16">
      {/* ── Top Header ─────────────────────────────────────────── */}
      <header className="rounded-2xl border border-neutral-dark/10 bg-surface p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/dashboard/applications"
              className="inline-flex items-center text-xs font-semibold text-neutral-dark/60 hover:text-primary transition"
            >
              ← Müraciətlərimə qayıt
            </Link>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-neutral-dark">
              Müraciət izləyicisi
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() => setAdding(!adding)}
            >
              <span>+</span>
              <span>Müraciət əlavə et</span>
            </button>
            <button
              className={BUTTON}
              disabled={busy}
              onClick={() =>
                downloadAuthedFile(
                  "/application-tracker/export.csv",
                  "aise-muracietler.csv",
                )
              }
            >
              Excel üçün CSV yüklə
            </button>
            <button className={BUTTON} disabled={busy} onClick={load} title="Siyahını yenilə">
              AISE nəticələrini yenilə
            </button>
          </div>
        </div>

        {/* Informative distinction between personal stage and system evidence */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-neutral-dark/75 pt-2 border-t border-neutral-dark/10">
          <div className="flex items-start gap-2">
            <span className="font-semibold text-neutral-dark">“Mərhələm”:</span>
            <span>Şəxsi irəliləyiş qeydinizdir (Müraciət, Müsahibə, Təklif, Qəbul). Xanaya klikləyərək dərhal yenilənir.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-semibold text-neutral-dark">“Sistem sübutu”:</span>
            <span>AISE və ya poçt xidmətinin təsdiqlədiyi rəsmi çatdırılma qəbzidir; işə qəbul zəmanəti deyil.</span>
          </div>
        </div>
      </header>

      {/* ── Notifications & Alerts ────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50/90 p-4 text-sm font-medium text-rose-900 shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-rose-600 font-bold">✕</span>
            <span>{error}</span>
          </div>
          {failedEdits.current.size ? (
            <button
              className="rounded-lg bg-rose-200/80 px-3 py-1.5 text-xs font-bold text-rose-950 hover:bg-rose-300 transition cursor-pointer"
              disabled={busy}
              onClick={() => {
                for (const edit of failedEdits.current.values())
                  patch(edit.row, edit.fields);
              }}
            >
              Yenidən saxla
            </button>
          ) : (
            <button
              className="rounded-lg bg-rose-200/80 px-3 py-1.5 text-xs font-bold text-rose-950 hover:bg-rose-300 transition cursor-pointer"
              disabled={busy}
              onClick={load}
            >
              Yenidən yüklə
            </button>
          )}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg w-fit ${
            notice.includes("Saxlanılır")
              ? "bg-amber-100/80 text-amber-900 border border-amber-200 animate-pulse"
              : "bg-emerald-100 text-emerald-900 border border-emerald-300"
          }`}
        >
          <span>{notice.includes("Saxlanılır") ? "⏳" : "✓"}</span>
          <span>{notice}</span>
        </div>
      )}

      {/* ── Add Application Panel / Modal ──────────────────────── */}
      {adding && (
        <form
          className="rounded-2xl border-2 border-primary/20 bg-surface p-5 shadow-sm space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newTitle.trim() || !newCompany.trim()) {
              setError("Vəzifə və şirkət adını daxil edin.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              const r = await apiFetch("/application-tracker", {
                method: "POST",
                body: JSON.stringify({
                  title: newTitle.trim(),
                  company: newCompany.trim(),
                  url: newUrl.trim() || undefined,
                  stage: newStage,
                  notes: newNotes.trim() || undefined,
                }),
              });
              if (!r.ok) {
                const errData = await r.json().catch(() => null);
                throw new Error(errData?.message || "Müraciət əlavə edilmədi.");
              }
              await load();
              setNewTitle("");
              setNewCompany("");
              setNewUrl("");
              setNewNotes("");
              setNewStage("APPLIED");
              setAdding(false);
              setSearch("");
              setQ("");
              setStage("");
              setPage(1);
              setNotice("Müraciət əlavə edildi.");
              setTimeout(() => setNotice((n) => (n === "Müraciət əlavə edildi." ? "" : n)), 2500);
            } catch (err: any) {
              setError(err?.message || "Müraciət əlavə edilmədi.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-neutral-dark/10 pb-3">
            <h2 className="font-serif text-lg font-bold text-neutral-dark">
              Yeni müraciət qeydi
            </h2>
            <button
              type="button"
              className="text-xs text-neutral-dark/60 hover:text-neutral-dark font-semibold cursor-pointer"
              onClick={() => setAdding(false)}
            >
              Bağla ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-dark mb-1">
                Vəzifə <span className="text-rose-600">*</span>
              </label>
              <input
                required
                maxLength={300}
                className={INPUT}
                aria-label="Yeni vəzifə"
                placeholder="Məsələn: Daxili audit üzrə mütəxəssis"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-dark mb-1">
                Şirkət <span className="text-rose-600">*</span>
              </label>
              <input
                required
                maxLength={300}
                className={INPUT}
                aria-label="Yeni şirkət"
                placeholder="Məsələn: Deloitte Azərbaycan"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-dark mb-1">
                Keçid (Vakansiya linki)
              </label>
              <input
                type="url"
                maxLength={2000}
                className={INPUT}
                aria-label="Vakansiya keçidi"
                placeholder="https://..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-dark mb-1">
                İlkin mərhələ
              </label>
              <select
                className={INPUT}
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
              >
                <option value="PLANNED">Hazırlanır</option>
                <option value="APPLIED">Müraciət edilib</option>
                <option value="INTERVIEW">Müsahibə</option>
                <option value="OFFER">Təklif</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-dark mb-1">
              İlkin qeydlər
            </label>
            <input
              maxLength={5000}
              className={INPUT}
              placeholder="Əlaqə şəxsi, göndərilən CV variantı və s."
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className={BUTTON}
              onClick={() => setAdding(false)}
            >
              Ləğv et
            </button>
            <button className={PRIMARY_BUTTON} disabled={busy}>
              Əlavə et
            </button>
          </div>
        </form>
      )}

      {/* ── Search, Filters & Controls ─────────────────────────── */}
      <section className="rounded-2xl border border-neutral-dark/10 bg-surface p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick Filter Tabs */}
          <div className="flex flex-wrap gap-1.5 p-1 bg-neutral-dark/5 rounded-xl text-xs font-medium">
            <button
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                quickFilter === "all"
                  ? "bg-surface text-neutral-dark font-bold shadow-xs"
                  : "text-neutral-dark/70 hover:text-neutral-dark"
              }`}
              onClick={() => handleTabChange("all")}
            >
              Bütün müraciətlər
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                quickFilter === "active"
                  ? "bg-surface text-sky-900 font-bold shadow-xs"
                  : "text-neutral-dark/70 hover:text-neutral-dark"
              }`}
              onClick={() => handleTabChange("active")}
            >
              Aktivlər
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                quickFilter === "closed"
                  ? "bg-surface text-neutral-900 font-bold shadow-xs"
                  : "text-neutral-dark/70 hover:text-neutral-dark"
              }`}
              onClick={() => handleTabChange("closed")}
            >
              Nəticələnmiş
            </button>
          </div>

          <button
            type="button"
            className="text-xs font-semibold text-neutral-dark/70 hover:text-neutral-dark underline cursor-pointer"
            onClick={() => setShowColumnsConfig(!showColumnsConfig)}
          >
            {showColumnsConfig ? "Sütun sazlamalarını bağla" : "Sütunları fərdiləşdir"}
          </button>
        </div>

        {/* Search & Stage Dropdown Row */}
        <form
          className="flex flex-wrap items-center gap-3 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
            setPage(1);
          }}
        >
          <div className="flex-1 min-w-48">
            <input
              className={INPUT}
              aria-label="Cədvəldə axtar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Vəzifə, şirkət və ya qeyd ilə axtar..."
            />
          </div>
          <button className={BUTTON} disabled={busy}>
            Axtar
          </button>
          <div className="min-w-44">
            <select
              className={INPUT}
              aria-label="Mərhələyə görə süzgəc"
              value={stage}
              disabled={busy}
              onChange={(e) => handleStageChange(e.target.value)}
            >
              <option value="">
                {quickFilter === "active"
                  ? "Bütün aktiv mərhələlər"
                  : quickFilter === "closed"
                    ? "Bütün nəticələnmiş mərhələlər"
                    : "Bütün mərhələlər"}
              </option>
              {Object.entries(STAGES).map(([v, label]) => (
                <option value={v} key={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-neutral-dark/80 cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-neutral-dark/30 text-primary focus:ring-primary cursor-pointer"
              checked={hidden}
              disabled={busy}
              onChange={(e) => {
                setHidden(e.target.checked);
                setPage(1);
              }}
            />
            Gizlədilənləri də göstər
          </label>
        </form>

        {/* ── Column Customization Accordion ── */}
        {showColumnsConfig && (
          <div className="mt-4 pt-4 border-t border-neutral-dark/10 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-dark/70">
              Fərdi sütunların idarə edilməsi
            </h3>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (columnName.trim() && data) {
                  void columns([
                    ...data.columns,
                    { id: `c_${crypto.randomUUID()}`, name: columnName.trim() },
                  ]);
                  setColumnName("");
                }
              }}
            >
              <input
                maxLength={60}
                required
                aria-label="Yeni sütun adı"
                className={`${INPUT} max-w-xs`}
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                placeholder="Məsələn: Əlaqə şəxsi və ya Maaş"
              />
              <button
                className={BUTTON}
                disabled={busy || (data?.columns.length ?? 0) >= 20}
              >
                Sütun əlavə et
              </button>
            </form>
            <div className="flex flex-wrap gap-2 pt-1">
              {data?.columns.map((c, i) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1.5 rounded-xl border border-neutral-dark/15 bg-background p-1.5 text-xs"
                >
                  <input
                    aria-label="Sütun adı"
                    className="h-8 rounded-lg border border-transparent px-2 text-xs font-medium hover:border-neutral-dark/20 focus:border-primary focus:outline-hidden"
                    defaultValue={c.name}
                    onBlur={(e) => {
                      if (e.target.value !== c.name)
                        void columns(
                          data.columns.map((x) =>
                            x.id === c.id ? { ...x, name: e.target.value } : x,
                          ),
                        );
                    }}
                  />
                  <button
                    className="h-8 rounded-lg px-2 text-xs font-semibold text-neutral-dark/70 hover:bg-neutral-dark/5"
                    disabled={busy}
                    onClick={() =>
                      columns(
                        data.columns.map((x) =>
                          x.id === c.id ? { ...x, hidden: !x.hidden } : x,
                        ),
                      )
                    }
                  >
                    {c.hidden ? "Göstər" : "Gizlət"}
                  </button>
                  <button
                    className="h-8 rounded-lg px-2 text-xs font-semibold text-neutral-dark/70 hover:bg-neutral-dark/5"
                    aria-label={`${c.name} sütununu sola keçir`}
                    disabled={busy || i === 0}
                    onClick={() => {
                      const next = [...data.columns];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      void columns(next);
                    }}
                  >
                    ←
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Applications Data Display ─────────────────────────── */}
      {!data ? (
        <div className="rounded-2xl border border-neutral-dark/10 bg-surface p-12 text-center text-sm font-medium text-neutral-dark/60 shadow-xs">
          Yüklənir…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-dark/60 px-1">
            <span>
              Cəmi {data.total} müraciət
            </span>
            <span>
              Səhifə {data.page} / {data.pages}
            </span>
          </div>

          {/* Clean Responsive Table Container */}
          <div className="overflow-x-auto rounded-2xl border border-neutral-dark/15 bg-surface shadow-xs">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-neutral-dark/5 border-b border-neutral-dark/10 text-xs font-bold uppercase tracking-wider text-neutral-dark/70">
                <tr>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-44">Şirkət</th>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-48">Vəzifə</th>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-36">Tarix</th>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-44">Mərhələm</th>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-48">Sistem sübutu</th>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-40">Növbəti addım</th>
                  <th scope="col" className="p-3.5 whitespace-nowrap min-w-28 text-center">Görünüş</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-dark/10">
                {displayedRows.map((row) => {
                  const stageStyle = STAGE_STYLES[row.stage] ?? STAGE_STYLES.PLANNED;
                  const indicator = EVIDENCE_INDICATORS[row.evidence] ?? {
                    dot: "bg-neutral-400",
                    title: "Sübut statusu",
                  };
                  const nextAction = nextActionFor(row.stage, row.evidence);

                  return (
                    <React.Fragment key={row.key}>
                      {/* Primary Application Row */}
                      <tr
                        className={`transition-colors hover:bg-neutral-dark/[0.02] ${
                          row.hidden ? "opacity-60 bg-neutral-100/50" : ""
                        }`}
                      >
                        {/* 1. Company */}
                        <td className="p-2.5">
                          <div className="space-y-1">
                            {cell(row, "company")}
                            {row.url ? (
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline px-1"
                              >
                                <span>Keçidə bax</span> ↗
                              </a>
                            ) : null}
                          </div>
                        </td>

                        {/* 2. Role */}
                        <td className="p-2.5">
                          {cell(row, "title")}
                        </td>

                        {/* 3. Date */}
                        <td className="p-2.5">
                          {cell(row, "date")}
                        </td>

                        {/* 4. Stage (Candidate Controlled, 1-click update) */}
                        <td className="p-2.5">
                          <select
                            aria-label={`${row.title} mərhələm`}
                            defaultValue={row.stage}
                            className={`min-h-11 w-full rounded-xl border px-3 py-2 text-xs font-bold transition-all cursor-pointer shadow-xs ${stageStyle.bg} ${stageStyle.text} ${stageStyle.border}`}
                            disabled={busy}
                            onChange={(e) => {
                              patch(row, { stage: e.target.value });
                            }}
                          >
                            {Object.entries(STAGES).map(([v, label]) => (
                              <option key={v} value={v}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* 5. System Evidence (Verified Proof) */}
                        <td className="p-3">
                          <div
                            className="inline-flex items-center gap-2 rounded-lg border border-neutral-dark/10 bg-background px-2.5 py-1.5 text-xs font-medium text-neutral-dark"
                            title={indicator.title}
                          >
                            <span className={`h-2 w-2 rounded-full ${indicator.dot} shrink-0`} />
                            <span className="whitespace-nowrap">{EVIDENCE[row.evidence] ?? "Bilinmir"}</span>
                          </div>
                          <div className="text-[11px] text-neutral-dark/50 mt-0.5">
                            {SOURCES[row.source] ?? row.source}
                          </div>
                        </td>

                        {/* 6. Next Action */}
                        <td className="p-3 whitespace-nowrap">
                          <span className="inline-block rounded-md bg-neutral-dark/5 px-2 py-1 text-xs font-semibold text-neutral-dark/80">
                            {nextAction}
                          </span>
                        </td>

                        {/* 7. Hide / Restore */}
                        <td className="p-2.5 text-center">
                          <button
                            className="rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold text-neutral-dark/70 hover:bg-neutral-dark/5 hover:text-neutral-dark transition"
                            disabled={busy}
                            onClick={() => patch(row, { hidden: !row.hidden })}
                          >
                            {row.hidden ? "Bərpa et" : "Gizlət"}
                          </button>
                        </td>
                      </tr>

                      {/* Progressive Disclosure: Secondary Details (Notes, Custom Columns, URL) */}
                      <tr className="bg-neutral-dark/[0.015] border-b border-neutral-dark/10">
                        <td colSpan={7} className="px-3.5 py-2.5">
                          <details className="group/details">
                            <summary className="text-xs font-semibold text-neutral-dark/60 hover:text-primary cursor-pointer select-none list-none flex items-center gap-1.5 py-0.5">
                              <span className="text-[10px] transition-transform group-open/details:rotate-90">▶</span>
                              <span>Qeydlər, vakansiya linki və əlavə sahələr</span>
                            </summary>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-neutral-dark/5">
                              {/* Notes */}
                              <div className="md:col-span-2 space-y-1">
                                <label className="block text-[11px] font-semibold text-neutral-dark/70">
                                  Şəxsi qeydlər
                                </label>
                                {cell(row, "notes")}
                              </div>

                              {/* URL */}
                              <div className="space-y-1">
                                <label className="block text-[11px] font-semibold text-neutral-dark/70">
                                  Vakansiya keçidi (URL)
                                </label>
                                {cell(row, "url")}
                              </div>

                              {/* Custom Columns */}
                              {data.columns
                                .filter((c) => !c.hidden)
                                .map((c) => (
                                  <div key={c.id} className="space-y-1">
                                    <label className="block text-[11px] font-semibold text-neutral-dark/70">
                                      {c.name}
                                    </label>
                                    <input
                                      className={INPUT}
                                      aria-label={`${row.title}: ${c.name}`}
                                      defaultValue={row.custom[c.id] ?? ""}
                                      onFocus={(e) => {
                                        e.currentTarget.dataset.beforeEdit =
                                          e.currentTarget.value;
                                      }}
                                      maxLength={2000}
                                      onBlur={(e) => {
                                        if (
                                          e.target.value !==
                                          (e.currentTarget.dataset.beforeEdit ??
                                            row.custom[c.id] ??
                                            "")
                                        )
                                          patch(row, {
                                            custom: { [c.id]: e.target.value },
                                          });
                                      }}
                                    />
                                  </div>
                                ))}
                            </div>
                          </details>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {displayedRows.length === 0 && (
              <div className="p-12 text-center text-sm text-neutral-dark/60 space-y-2">
                <p className="font-semibold text-neutral-dark">
                  Müraciət tapılmadı.
                </p>
                <p className="text-xs">
                  AISE vasitəsilə müraciət etdikdə burada avtomatik görünəcək və ya yuxarıdakı “+ Müraciət əlavə et” düyməsi ilə özünüz qeyd edə bilərsiniz.
                </p>
              </div>
            )}
          </div>

          {/* ── Pagination ────────────────────────────────────────── */}
          <nav
            className="flex items-center justify-between pt-2 px-1 text-sm"
            aria-label="Cədvəl səhifələri"
          >
            <button
              className={BUTTON}
              disabled={busy || data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              ← Əvvəlki
            </button>
            <span className="text-xs font-semibold text-neutral-dark/70">
              Səhifə {data.page} / {data.pages}
            </span>
            <button
              className={BUTTON}
              disabled={busy || data.page >= data.pages}
              onClick={() => setPage(data.page + 1)}
            >
              Növbəti →
            </button>
          </nav>
        </div>
      )}
    </main>
  );
}

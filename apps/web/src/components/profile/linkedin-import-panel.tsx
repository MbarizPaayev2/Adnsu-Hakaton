'use client';

import React from 'react';

type Props = {
  text: string;
  onTextChange: (text: string) => void;
  onImport: (allowPublicReader?: boolean) => void;
  onFile: (file: File) => void;
  busy: boolean;
  error: string | null;
};

export function LinkedInImportPanel({ text, onTextChange, onImport, onFile, busy, error }: Props) {
  const [consentedUrl, setConsentedUrl] = React.useState<string | null>(null);
  const urlOnly = /^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/\S+$/i.test(text.trim());
  const canSubmit = urlOnly || text.trim().length >= 40;

  return (
    <section className="mt-6 rounded-2xl border border-neutral-dark/15 bg-background-warm/20 p-4 sm:p-5" aria-labelledby="linkedin-import-heading">
      <h2 id="linkedin-import-heading" className="font-semibold text-neutral-dark">LinkedIn profilindən əlavə edin</h2>
      <p className="mt-2 text-sm text-neutral-dark/75">
        Profilinizin keçidini (URL) daxil edin, təcrübə və təhsil bölmələrini kopyalayıb yapışdırın,
        yaxud LinkedIn-dən saxladığınız PDF-i yükləyin. Oxunan məlumatları təsdiqləməzdən əvvəl yoxlayıb redaktə edə bilərsiniz.
      </p>
      <p className="mt-2 text-xs text-neutral-dark/70">
        Açıq profil olsa belə, LinkedIn avtomatik oxumağa giriş tələb edə bilər. Keçidlə tam idxala zəmanət verilmir. Belə halda, profil mətnini yapışdıra və ya PDF faylını yükləyə bilərsiniz. Yüklənmiş əsas CV faylınız əvəz olunmur.
      </p>
      <details className="mt-3 text-xs text-neutral-dark/75">
        <summary className="cursor-pointer font-semibold">LinkedIn PDF-ini necə əldə edim?</summary>
        <p className="mt-2">Kompüterdə öz LinkedIn profilinizi açın. “More” menyusunda “Save to PDF” seçimi varsa, faylı saxlayıb burada yükləyin. Bu seçim görünmürsə, profil mətnini kopyalayın.</p>
      </details>
      <label className="mt-4 block text-xs font-semibold" htmlFor="linkedin-profile-text">LinkedIn profil mətni</label>
      <textarea id="linkedin-profile-text" className="mt-2 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 px-3 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
        rows={6} maxLength={60000} value={text} onChange={(e) => onTextChange(e.target.value)} disabled={busy}
        placeholder="https://www.linkedin.com/in/... və ya profilinizin mətnini bura yapışdırın" />
      {urlOnly && <p role="status" className="mt-2 text-sm text-neutral-dark/75">Profil keçidi aşkarlandı. Açıq məlumatları oxumağa cəhd edə bilərsiniz; LinkedIn bloklayarsa, PDF və ya mətnlə davam edin.</p>}
      {urlOnly && (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-neutral-dark/80">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 accent-primary" disabled={busy} checked={consentedUrl === text.trim()}
              onChange={(e) => setConsentedUrl(e.target.checked ? text.trim() : null)} />
            <span>Birbaşa oxunma alınmasa, Jina AI vasitəsilə alternativ oxumaya icazə verirəm.</span>
          </label>
          <p className="mt-2">Bu seçimlə yalnız daxil etdiyiniz LinkedIn ünvanı Jina AI-yə göndərilir və profilin ictimai məlumatları Azərbaycan xaricində emal oluna bilər. AISE-dəki CV faylınız, parolunuz və profil məlumatlarınız göndərilmir. Seçim məcburi deyil; PDF və mətnlə idxal mövcuddur. <a href="/service-providers#linkedin-reader" className="underline">Təminatçı haqqında</a></p>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50/80 p-3 text-xs text-red-900 space-y-2">
          <p className="font-semibold text-red-800">{error}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-red-200/60">
            <span className="text-neutral-dark/80">Dərhal alternativ üsulla davam edin:</span>
            <label className="cursor-pointer inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-neutral-dark border border-neutral-dark/20 shadow-xs hover:bg-neutral-light transition-colors">
              LinkedIn PDF-i seçin
              <input type="file" aria-label="LinkedIn PDF-i seçin" accept=".pdf,application/pdf" className="sr-only" disabled={busy}
                onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }} />
            </label>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('linkedin-profile-text') as HTMLTextAreaElement | null;
                el?.focus();
              }}
              className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-neutral-dark border border-neutral-dark/20 shadow-xs hover:bg-neutral-light transition-colors"
            >
              Profil mətnini yapışdırın
            </button>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => { const allowed = urlOnly && consentedUrl === text.trim(); setConsentedUrl(null); onImport(allowed); }} disabled={busy || !canSubmit}
          className="min-h-11 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Oxunur...' : urlOnly ? 'Keçiddən çıxar' : 'Mətni oxu'}
        </button>
        <label className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border border-neutral-dark/25 px-5 py-2 text-sm font-semibold ${busy ? 'opacity-50' : ''}`}>
          LinkedIn PDF-i yüklə
          <input type="file" aria-label="LinkedIn PDF-i yüklə" accept=".pdf,application/pdf" className="sr-only" disabled={busy}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }} />
        </label>
      </div>
    </section>
  );
}

import { summarizeDocuments } from './admin-ops.service';

describe('summarizeDocuments (operator view of document generation)', () => {
  it('counts outcomes and failure codes, never content', () => {
    const out = summarizeDocuments([
      { status: 'READY', statusError: null },
      { status: 'NEEDS_REVIEW', statusError: null },
      { status: 'PENDING', statusError: null },
      { status: 'FAILED', statusError: 'Yaradılan mətn Azərbaycan dili keyfiyyət yoxlamasından keçmədi. (LANGUAGE_QUALITY)' },
      { status: 'FAILED', statusError: 'Yaradılan mətn Azərbaycan dili keyfiyyət yoxlamasından keçmədi. (LANGUAGE_QUALITY)' },
      { status: 'FAILED', statusError: 'PDF yaradıla bilmədi. (PDF_FAILED)' },
      { status: 'FAILED', statusError: null },
    ]);
    expect(out).toEqual({ total: 7, pending: 1, needsReview: 1, ready: 1, failed: 4, failedByCode: { LANGUAGE_QUALITY: 2, PDF_FAILED: 1, UNKNOWN: 1 } });
  });
});

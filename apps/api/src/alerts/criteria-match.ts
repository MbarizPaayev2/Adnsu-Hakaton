import { foldText } from '../jobs/job-location.util';
import type { CatalogueItem } from '../jobs/job-catalogue.service';
import type { SearchCriteria } from '../saved/search-criteria';

const BAKU = ['baki', 'baku', 'баку'];

// Mirrors JobCatalogueService.list's SQL filters for ONE already-loaded row (the catalogue's own folded LIKE semantics), so a saved search
// notifies for exactly the postings the same filters would list. alerts.criteria-parity.e2e checks this against the SQL.
const fold = (v: string | null | undefined) => foldText(v);

export function rowMatchesCriteria(item: Pick<CatalogueItem, 'title' | 'company' | 'location' | 'source' | 'category' | 'workArrangement' | 'experienceLevel'>, c: SearchCriteria): boolean {
  if (c.q && !(fold(item.title).includes(fold(c.q)) || fold(item.company).includes(fold(c.q)))) return false;
  if (c.location) {
    const f = fold(c.location);
    const terms = BAKU.includes(f) ? BAKU : [f];
    if (!terms.some((t) => fold(item.location).includes(t))) return false;
  }
  if (c.source && c.source !== 'all' && item.source !== c.source) return false;
  if (c.category && c.category !== 'all' && item.category !== c.category) return false;
  if (c.company && fold(item.company) !== fold(c.company)) return false;
  if (c.work && c.work !== 'all') {
    if (c.work === 'unknown' ? item.workArrangement !== null : item.workArrangement !== c.work) return false;
  }
  if (c.experience && c.experience !== 'all') {
    if (c.experience === 'unknown' ? item.experienceLevel !== null : item.experienceLevel !== c.experience) return false;
  }
  return true;
}

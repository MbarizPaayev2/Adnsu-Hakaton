import { PublicJobCollector } from './public-job-collector';
import { AbbCollector } from './abb.collector';
import { PwcCollector } from './pwc.collector';
import { KpmgCcaCollector } from './kpmg-cca.collector';
import { SmartjobCollector } from './smartjob.collector';
import { BossCollector } from './boss.collector';
import { WorkCollector } from './work.collector';
import { EjobCollector } from './ejob.collector';
import { JobsearchCollector } from './jobsearch.collector';
import { HrinCollector } from './hrin.collector';
import { LinkedInCollector } from './linkedin.collector';
import { YeloCollector } from './yelo.collector';
import { KapitalCollector } from './kapital.collector';
import { BankerCollector } from './banker.collector';
import { LocalEmployerCollector, LOCAL_EMPLOYERS, type LocalEmployer } from './local-employer.collector';
import { AnnouncementPagesCollector, ANNOUNCEMENT_SOURCES, type AnnouncementSource } from './announcement-pages';
import { SAP_SOURCES, SapCareersCollector, type SapSource } from './sap-careers.collector';
import { WORKABLE_TENANTS, WorkableCollector, type WorkableTenant } from './workable.collector';
import { TEAMTAILOR_TENANTS, TeamtailorCollector, type TeamtailorTenant } from './teamtailor.collector';
import { LEVER_TENANTS, LeverCollector, type LeverTenant } from './lever.collector';
import { WORKDAY_TENANTS, WorkdayCollector, type WorkdayTenant } from './workday.collector';
import { GREENHOUSE_TENANTS, GreenhouseCollector, type GreenhouseTenant } from './greenhouse.collector';

/** Every reviewed collector, by source key (the externalId prefix and the JobSource key). One list for the CLI and the scheduler. */
export const COLLECTOR_KEYS: readonly string[] = [
  'hellojob', 'abb', 'pwc', 'kpmg-cca', 'smartjob', 'boss', 'work', 'ejob', 'jobsearch', 'hrin', 'linkedin', 'yelo', 'kapital', 'banker',
  ...Object.keys(LOCAL_EMPLOYERS),
  ...Object.keys(ANNOUNCEMENT_SOURCES),
  ...Object.keys(SAP_SOURCES),
  ...Object.keys(WORKABLE_TENANTS),
  ...Object.keys(TEAMTAILOR_TENANTS),
  ...Object.keys(LEVER_TENANTS),
  ...Object.keys(WORKDAY_TENANTS),
  ...Object.keys(GREENHOUSE_TENANTS),
];

export function collectorFor(key: string) {
  if (key === 'hellojob') return new PublicJobCollector();
  if (key === 'abb') return new AbbCollector();
  if (key === 'pwc') return new PwcCollector();
  if (key === 'kpmg-cca') return new KpmgCcaCollector();
  if (key === 'smartjob') return new SmartjobCollector();
  if (key === 'boss') return new BossCollector();
  if (key === 'work') return new WorkCollector();
  if (key === 'ejob') return new EjobCollector();
  if (key === 'jobsearch') return new JobsearchCollector();
  if (key === 'hrin') return new HrinCollector();
  if (key === 'linkedin') return new LinkedInCollector();
  if (key === 'yelo') return new YeloCollector();
  if (key === 'kapital') return new KapitalCollector();
  if (key === 'banker') return new BankerCollector();
  if (key in LOCAL_EMPLOYERS) return new LocalEmployerCollector(key as LocalEmployer);
  if (key in ANNOUNCEMENT_SOURCES) return new AnnouncementPagesCollector(key as AnnouncementSource);
  if (key in SAP_SOURCES) return new SapCareersCollector(key as SapSource);
  if (key in WORKABLE_TENANTS) return new WorkableCollector(key as WorkableTenant);
  if (key in TEAMTAILOR_TENANTS) return new TeamtailorCollector(key as TeamtailorTenant);
  if (key in LEVER_TENANTS) return new LeverCollector(key as LeverTenant);
  if (key in WORKDAY_TENANTS) return new WorkdayCollector(key as WorkdayTenant);
  if (key in GREENHOUSE_TENANTS) return new GreenhouseCollector(key as GreenhouseTenant);
  return null;
}

import { LocalEmployerCollector, employerDeadline, localEmployerUrl, parseEmployerDetail, parseEmployerListing } from './local-employer.collector';
import { deriveJobFacts } from '../../jobs/job-facts';

const at = new Date('2026-10-13T16:00:00Z');
const list = '<section id="vacancies" data-site-section="career.vacancies"><a class="career-vacancy-card__link" href="/az/vakansiya-etrafli/98">Sales</a></section><div class="career-hero__facts"><div><strong>1</strong> aktiv vakansiya</div></div>';
const detail = '<div class="av-vacancy-detail"><article><h1>Sales specialist</h1><dl><div><dt>Şəhər</dt><dd>Bakı</dd></div></dl><div class="av-richtext"><p>Satışları idarə etmək. Excel bilikləri.</p><p>CV-lərini mövzu hissəsinə “Sales specialist” yazaraq hr@avrora.az ünvanına göndərmələri xahiş olunur.</p></div></article><aside><form>NOT JOB CONTENT</form></aside></div><footer>office@avrora.az</footer>';
const vlist = (id: number, end: boolean) => `<input id="getAllVacancies"><div class="vacancy-body"><input class="hide-vacancy-view-more-btn" value="${end}"><a href="/vac/detail?vacancyId=${id}">Detail</a><a href="/vac/savedpost?vacancyId=9">Save</a></div>`;
const vdetail = '<title>Veyseloglu MMC - Operator</title><h1 class="vacancies-header__title">Operator</h1><div class="vacancy-info"><h5 class="vacancy-info__title">Şəhər</h5><span class="vacancy-info__degree">Gəncə</span></div><div class="vacancy-info"><h5 class="vacancy-info__title">Son müraciət tarixi</h5><span class="vacancy-info__degree">31 Oct</span></div><div class="vacancy-container__left"><h4>Öhdəliklər</h4><p>Anbar sifarişlərini yoxlamaq.</p></div>';
const gold = '<div class="breadcrumb_container"><p>Geologiya / Mühəndis-geoloq</p><div><span>İş yeri:</span><span>Daşkəsən rayonu</span></div><p><span>Son müraciət :</span><span>20 oktyabr 2026</span></p></div><div class="markup"><h6>Tələblər</h6><p>Geologiya təhsili və sahə təcrübəsi.</p></div><footer>Privacy contact info@azergold.az</footer>';

describe('reviewed local employer collectors', () => {
  it.each(['https://evil.example/az/karyera','https://user:pw@www.avrora.az/az/karyera','https://www.avrora.az/az/vacancy-request','https://www.avrora.az/az/giris','https://www.avrora.az/az/vakansiya-etrafli/98?token=x','https://www.avrora.az/az/%2e%2e/giris'])("rejects unreviewed/submission URL %s", url => expect(() => localEmployerUrl('avrora',url)).toThrow());
  it('rejects Veyseloglu account, save, ambiguous ID and arbitrary paging requests', () => {
    for (const url of ['/vac/savedpost?vacancyId=1','/account/login','/vac/detail?vacancyId=1&vacancyId=2','/home/allvacancies?pageIndex=0&pageSize=5','/home/allvacancies?pageIndex=1&pageSize=500']) expect(() => localEmployerUrl('veyseloglu',url)).toThrow();
  });
  it('recognizes active count, detects incomplete listings and refuses maintenance', () => {
    expect(parseEmployerListing('avrora',list)).toMatchObject({complete:true});
    expect(parseEmployerListing('avrora',list.replace('>1</strong>','>2</strong>'))).toMatchObject({complete:false});
    expect(() => parseEmployerListing('avrora','<h1>Maintenance</h1>')).toThrow();
    expect(() => parseEmployerListing('avrora',list.replace('</section>', '<a class="career-vacancy-card__link" href="/az/vakansiya-etrafli/98">Again</a></section>'))).toThrow('Repeated');
    expect(parseEmployerListing('azergold','<table><tr><td><a href="/vacancies/geologist">Geologist</a></td></tr></table><p>Ümumi vakansiya sayı: 1</p><div class="pagination_container"></div>')).toMatchObject({complete:true});
    expect(parseEmployerListing('azergold','<table><tr><td><a href="/vacancies/geologist">Title</a><a href="/vacancies/geologist">Mobile action</a></td></tr></table><p>Ümumi vakansiya sayı: 1</p><div class="pagination_container"></div>')).toMatchObject({complete:true,urls:['https://careers.azergold.az/vacancies/geologist']});
  });
  it('keeps job text and explicit application instructions, never a footer contact or form', () => {
    const job = parseEmployerDetail('avrora',detail,'/az/vakansiya-etrafli/98',at);
    expect(job.description).not.toContain('NOT JOB CONTENT');
    expect(job.description).not.toContain('office@');
    expect(job.deadline).toBeUndefined();
    expect(deriveJobFacts(job)).toMatchObject({applicationMethod:'EMAIL',applicationEmail:'hr@avrora.az'});
    const contactOnly = parseEmployerDetail('avrora', detail.replace(/<p>CV-lərini.*?<\/p>/,'') ,'/az/vakansiya-etrafli/98',at);
    expect(deriveJobFacts(contactOnly).applicationMethod).not.toBe('EMAIL');
  });
  it('uses the source city and full dated mining deadline; never the footer', () => {
    const job = parseEmployerDetail('azergold',gold,'/vacancies/geologist',at);
    expect(job).toMatchObject({location:'Daşkəsən rayonu',deadline:'2026-10-20T19:59:59.999Z',company:'AzerGold'});
    expect(job.description).not.toContain('Privacy');
    expect(deriveJobFacts(job).applicationMethod).not.toBe('EMAIL');
  });
  it.each(['31 fevral 2026','0 oktyabr 2026','20 unknown 2026','20 Oct','20 oktyabr'])('refuses guessed or impossible deadlines %s',s => expect(() => employerDeadline(s)).toThrow());
  it('does not guess a deadline year or publication date for the active Veyseloglu list', () => {
    const job = parseEmployerDetail('veyseloglu',vdetail,'/vac/detail?vacancyId=1167',at);
    expect(job.deadline).toBeUndefined();
    expect(job.rawPayload).toMatchObject({deadlineText:'31 Oct',deadlineYearUnknown:true,postedAtBasis:'first-observed'});
    expect(job.location).toBe('Gəncə');
    expect(() => parseEmployerDetail('veyseloglu',vdetail.replace('Veyseloglu MMC','Other employer'),'/vac/detail?vacancyId=1',at)).toThrow();
  });
  it('stops without later requests on 403/429, and does not equate failures with an empty complete listing', async () => {
    for (const status of [403,429]) {
      const read = jest.fn(async (url:string) => url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : url.endsWith('/az/karyera') ? list : Promise.reject(new Error(`Source HTTP ${status}`)));
      const report = await new LocalEmployerCollector('avrora',read,async()=>{},()=>at).collect({maxPages:2,maxJobs:10,delayMs:1500},async()=>{});
      expect(report.complete).toBe(false); expect(report.error).toContain(String(status)); expect(read).toHaveBeenCalledTimes(3);
    }
  });
  it('honours robot prohibition before requesting the listing', async () => {
    const read = jest.fn(async () => 'User-agent: *\nDisallow: /az');
    const report=await new LocalEmployerCollector('avrora',read,async()=>{},()=>at).collect({maxPages:1,maxJobs:10,delayMs:1500},async()=>{});
    expect(report.complete).toBe(false);expect(read).toHaveBeenCalledTimes(1);
  });
  it('reads only reviewed public GET pages, honours crawl delay and never skips a capped detail', async () => {
    const read=jest.fn(async(url:string)=>url.endsWith('/robots.txt')?'User-agent: *\nAllow: /\nCrawl-delay: 2':url.endsWith('/az/karyera')?list:detail);
    const pause=jest.fn(async()=>{}), accept=jest.fn(async()=>{});
    expect(await new LocalEmployerCollector('avrora',read,pause,()=>at).collect({maxPages:1,maxJobs:1,delayMs:1500},accept)).toMatchObject({complete:true,accepted:1});
    expect(pause.mock.calls.every(([ms])=>ms>=2000)).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
  });
  it('allows only a genuine 404 for missing Veyseloglu robots and walks to the explicit end', async () => {
    const read=jest.fn(async(url:string)=>{if(url.endsWith('/robots.txt'))throw new Error('Source HTTP 404');if(url.includes('pageIndex=1'))return vlist(1,false);if(url.includes('pageIndex=2'))return vlist(2,true);return vdetail;});
    const accepted:string[]=[];
    expect(await new LocalEmployerCollector('veyseloglu',read,async()=>{},()=>at).collect({maxPages:3,maxJobs:10,delayMs:1500},async j=>{accepted.push(j.externalId);})).toMatchObject({complete:true,pages:2,accepted:2});
    expect(accepted).toEqual(['veyseloglu:1','veyseloglu:2']);
    const blocked=jest.fn(async()=>{throw new Error('Source HTTP 403');});
    expect((await new LocalEmployerCollector('veyseloglu',blocked,async()=>{},()=>at).collect({maxPages:3,maxJobs:10,delayMs:1500},async()=>{})).complete).toBe(false);
    expect(blocked).toHaveBeenCalledTimes(1);
  });
  it('refuses repeated pagination and budget/parser failures as complete evidence', async () => {
    const read=async(url:string)=>url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':url.includes('allvacancies')?vlist(1,false):vdetail;
    expect((await new LocalEmployerCollector('veyseloglu',read,async()=>{},()=>at).collect({maxPages:2,maxJobs:10,delayMs:1500},async()=>{})).error).toContain('repeated');
    const broken=async(url:string)=>url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':url.includes('/az/karyera')?list:'<h1>Unavailable</h1>';
    expect(await new LocalEmployerCollector('avrora',broken,async()=>{},()=>at).collect({maxPages:1,maxJobs:10,delayMs:1500},async()=>{})).toMatchObject({complete:false,failed:1});
  });
  it('parses Bravo listing and decodes Cloudflare-protected email applications', () => {
    const listHtml = `<h1>Bütün vakansiyalar</h1><div class="vacancies_grid">
      <article><h3>Mühafizəçi</h3><footer><p>Bakı</p><time></time></footer><a href="/career/all-vacancies/markets/muhafiz-ci-1/" class="full_link"></a></article>
      <article><h3>Pərakəndə satış rəhbəri</h3><footer><p>Bakı</p><time>15 Oktyabr - 30 Oktyabr</time></footer><a href="/career/all-vacancies/head-office/retail-lead/" class="full_link"></a></article>
    </div>`;
    const listing = parseEmployerListing('bravo', listHtml);
    expect(listing.complete).toBe(true);
    expect(listing.urls).toHaveLength(2);
    expect(listing.urls[0]).toBe('https://www.bravosupermarket.az/career/all-vacancies/markets/muhafiz-ci-1/');

    const detailHtml = `<div class="special_first"><div><h1>Pərakəndə satış rəhbəri</h1><!--<p>Bakı</p>--></div></div>
      <div class="article_wrapper"><div><div class="article_text"><p>Vəzifə öhdəlikləri: Strategiya qurmaq.</p>
      <p>CV göndərmək üçün <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="452d377705243f203727242c2f242b36303520372824372e20316b262a28">[email&#160;protected]</a> ünvanına müraciət edin.</p></div></div></div>`;
    const job = parseEmployerDetail('bravo', detailHtml, '/career/all-vacancies/head-office/retail-lead/', at);
    expect(job).toMatchObject({
      externalId: 'bravo:retail-lead',
      title: 'Pərakəndə satış rəhbəri',
      company: 'Bravo',
      location: 'Azərbaycan (şəhər göstərilməyib)',
    });
    expect(job.rawPayload).toMatchObject({ locationBasis: 'not-specified' });
    const listingFacts = parseEmployerListing('bravo', listHtml).factsByUrl?.['https://www.bravosupermarket.az/career/all-vacancies/head-office/retail-lead/'];
    expect(listingFacts).toEqual({ location: 'Bakı', listingWindowText: '15 Oktyabr - 30 Oktyabr' });
    expect(parseEmployerDetail('bravo', detailHtml, '/career/all-vacancies/head-office/retail-lead/', at, listingFacts)).toMatchObject({
      location: 'Bakı', rawPayload: { locationBasis: 'listing-card', listingWindowText: '15 Oktyabr - 30 Oktyabr' },
    });
    expect(job.description).toContain('hr2@azerbaijansupermarket.com');
    expect(deriveJobFacts(job)).toMatchObject({
      applicationMethod: 'EMAIL',
      applicationEmail: 'hr2@azerbaijansupermarket.com',
    });

    for (const bad of ['/site/assets/file.pdf', '/career/login', 'https://other.example/career/all-vacancies/']) {
      expect(() => localEmployerUrl('bravo', bad)).toThrow();
    }
  });
});

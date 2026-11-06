import { evaluateJob, renderTemplate } from './email-automation.service';
import { suggestFromSubject } from './reply-suggestion';

const rules = { allowedRoles: ['analyst', 'mühasib'], allowedLocations: ['Bakı'], allowedEmployers: [] as string[], excludedEmployers: ['Bad Corp'], excludedKeywords: ['commission only'] };
const job = (over: Record<string, string> = {}) => ({ title: 'Senior Analyst', company: 'Good LLC', location: 'Bakı', description: 'Send your CV to hr@good.az', ...over });

describe('automatic-mode rules', () => {
  it('applies only when every stated rule is met by facts the posting actually gives', () => {
    expect(evaluateJob(job(), rules)).toEqual({ ok: true });
    expect(evaluateJob(job({ title: 'MÜHASİB' }), rules)).toEqual({ ok: true }); // folded Azerbaijani letters
    expect(evaluateJob(job({ title: 'Driver' }), rules)).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
    expect(evaluateJob(job({ location: 'Gəncə' }), rules)).toEqual({ ok: false, reason: 'LOCATION_NOT_ALLOWED' });
  });
  it('stops on an unknown location instead of guessing', () => {
    expect(evaluateJob(job({ location: 'Azerbaijan' }), rules)).toEqual({ ok: false, reason: 'LOCATION_UNKNOWN' });
    expect(evaluateJob(job({ location: '' }), rules)).toEqual({ ok: false, reason: 'LOCATION_UNKNOWN' });
  });
  it('honours exclusions before allowances', () => {
    expect(evaluateJob(job({ company: 'Bad Corp Ltd' }), rules)).toEqual({ ok: false, reason: 'EXCLUDED_EMPLOYER' });
    expect(evaluateJob(job({ description: 'Pay: commission only' }), rules)).toEqual({ ok: false, reason: 'EXCLUDED_KEYWORD' });
    expect(evaluateJob(job({ company: 'Other' }), { ...rules, allowedEmployers: ['Good'] })).toEqual({ ok: false, reason: 'EMPLOYER_NOT_ALLOWED' });
  });
  it.each(['Please include your salary expectation', 'Portfolio is required', 'Attach diploma copies', 'Answer the following questions', 'Motivasiya məktubu göndərin'])('stops when the posting asks for more than a CV: %s', (extra) => {
    expect(evaluateJob(job({ description: `Send your CV to hr@good.az. ${extra}` }), rules)).toEqual({ ok: false, reason: 'EXTRA_REQUIREMENTS' });
  });
  it('fills only the permitted placeholders and tidies empty references', () => {
    expect(renderTemplate('Hello,\nI apply for {{title}} at {{company}} ({{reference}}).\n{{name}}', { title: 'Analyst', company: 'Good', reference: null, name: 'Aysel' })).toBe('Hello,\nI apply for Analyst at Good .\nAysel');
    expect(renderTemplate('Ref {{reference}}', { title: 't', company: 'c', reference: 'R-9', name: 'n' })).toBe('Ref R-9');
  });
});

describe('reply suggestions', () => {
  it.each([
    ['Interview invitation', 'INTERVIEW_INVITED'], ['Müsahibəyə dəvət', 'INTERVIEW_INVITED'], ['Job offer for Analyst', 'OFFER'],
    ['Unfortunately we cannot proceed', 'REJECTED'], ['К сожалению, мы не можем', 'REJECTED'], ['We have received your application', 'ACKNOWLEDGED'],
  ])('reads %s as %s', (subject, state) => expect(suggestFromSubject(subject)?.state).toBe(state));
  it('says nothing for an ambiguous subject, and never suggests HIRED or WITHDRAWN', () => {
    expect(suggestFromSubject('Re: Re: question')).toBeNull();
    expect(suggestFromSubject('Congratulations, you are hired')).toBeNull();
  });
});

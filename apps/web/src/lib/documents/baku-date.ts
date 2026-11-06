const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];

/**
 * "1 noyabr 2026, 00:00" in Baku time. The Azerbaijani month names are carried here rather than taken from the browser: some browser builds have no
 * Azerbaijani locale data and print "2026 M11 1" for the same date, which would turn the allowance reset time into nonsense.
 */
export function formatBakuDateTime(iso?: string | null, opts: { time?: boolean } = { time: true }): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baku', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = `${Number(get('day'))} ${AZ_MONTHS[Number(get('month')) - 1]} ${get('year')}`;
  return opts.time === false ? day : `${day}, ${get('hour')}:${get('minute')}`;
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const WEEKDAYS: Record<string, string> = { Mon: 'bazar ertəsi', Tue: 'çərşənbə axşamı', Wed: 'çərşənbə', Thu: 'cümə axşamı', Fri: 'cümə', Sat: 'şənbə', Sun: 'bazar' };

/**
 * "20 oktyabr 2026, çərşənbə axşamı, 10:00 (Asia/Baku)" for an instant, in the named IANA zone. Written out
 * rather than left to the browser's locale data, which differs between browsers for Azerbaijani.
 */
export function formatInterview(iso: string | Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${WEEKDAYS[parts.weekday] ?? parts.weekday}, ${parts.hour}:${parts.minute} (${timeZone})`;
}

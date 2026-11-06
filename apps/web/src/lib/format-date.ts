/** Format calendar dates consistently for Azerbaijani audiences and timezone. */
export function formatAzDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('az-AZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Baku',
  }).format(date);
}

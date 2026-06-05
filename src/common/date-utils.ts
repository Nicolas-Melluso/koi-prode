export function parseWorldCup26LocalDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, month, day, year, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:00`;
}

export function nowSql(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds())
  ].join('');
}

export function compareSqlDate(a: string, b: string): number {
  return new Date(a.replace(' ', 'T')).getTime() - new Date(b.replace(' ', 'T')).getTime();
}

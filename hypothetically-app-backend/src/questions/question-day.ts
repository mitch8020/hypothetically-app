export const DEFAULT_QUESTION_TIME_ZONE = 'America/Chicago';

export function questionDayKey(
  date: Date,
  timeZone = DEFAULT_QUESTION_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) {
    throw new Error(`Could not calculate a calendar day for ${timeZone}.`);
  }
  return `${year}-${month}-${day}`;
}

export function previousQuestionDay(dayKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error('Question day keys must use YYYY-MM-DD.');
  }
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Question day key is not a real calendar day.');
  }
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function requiredAnswerCount(previousDayVisitors: number): number {
  if (!Number.isInteger(previousDayVisitors) || previousDayVisitors < 0) {
    throw new Error('Previous-day visitors must be a non-negative integer.');
  }
  return Math.max(1, Math.ceil(previousDayVisitors / 5));
}

export function assertTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new Error('APP_TIME_ZONE must be a valid IANA time zone.');
  }
}

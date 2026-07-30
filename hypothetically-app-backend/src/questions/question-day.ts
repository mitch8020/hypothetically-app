export const DEFAULT_QUESTION_TIME_ZONE = 'America/Chicago';
const UNLOCK_SEARCH_WINDOW_MS = 36 * 60 * 60 * 1_000;

function parseQuestionDay(dayKey: string): [number, number, number] {
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
  return [year, month, day];
}

function moveQuestionDay(dayKey: string, days: number): string {
  const [year, month, day] = parseQuestionDay(dayKey);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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

export function isQuestionGenerationHour(
  date: Date,
  timeZone = DEFAULT_QUESTION_TIME_ZONE,
): boolean {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour')?.value;
  if (hour === undefined) {
    throw new Error(`Could not calculate a local hour for ${timeZone}.`);
  }
  return hour === '00';
}

export function previousQuestionDay(dayKey: string): string {
  return moveQuestionDay(dayKey, -1);
}

export function nextQuestionDay(dayKey: string): string {
  return moveQuestionDay(dayKey, 1);
}

export function canonicalTimeZone(timeZone: string): string {
  const candidate = timeZone.trim();
  if (!candidate) {
    throw new Error('Time zone must be a valid IANA time zone.');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: candidate,
    }).resolvedOptions().timeZone;
  } catch {
    throw new Error('Time zone must be a valid IANA time zone.');
  }
}

export function dailyQuestionUnlockAt(dayKey: string, timeZone: string): Date {
  const canonicalZone = canonicalTimeZone(timeZone);
  const nextDay = nextQuestionDay(dayKey);
  const [year, month, day] = parseQuestionDay(nextDay);
  const utcGuess = Date.UTC(year, month - 1, day);
  let lower = utcGuess - UNLOCK_SEARCH_WINDOW_MS;
  let upper = utcGuess + UNLOCK_SEARCH_WINDOW_MS;

  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (questionDayKey(new Date(middle), canonicalZone) < nextDay) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return new Date(lower);
}

export function assertTimeZone(timeZone: string): string {
  try {
    return canonicalTimeZone(timeZone);
  } catch {
    throw new Error('APP_TIME_ZONE must be a valid IANA time zone.');
  }
}

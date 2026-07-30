import {
  canonicalTimeZone,
  dailyQuestionUnlockAt,
  isQuestionGenerationHour,
  nextQuestionDay,
  previousQuestionDay,
  questionDayKey,
} from './question-day';

describe('question day rules', () => {
  it('uses America/Chicago across daylight-saving boundaries', () => {
    expect(
      questionDayKey(new Date('2026-03-08T05:59:59.000Z'), 'America/Chicago'),
    ).toBe('2026-03-07');
    expect(
      questionDayKey(new Date('2026-03-08T06:00:00.000Z'), 'America/Chicago'),
    ).toBe('2026-03-08');
    expect(
      questionDayKey(new Date('2026-11-01T04:59:59.000Z'), 'America/Chicago'),
    ).toBe('2026-10-31');
    expect(
      questionDayKey(new Date('2026-11-01T05:00:00.000Z'), 'America/Chicago'),
    ).toBe('2026-11-01');
  });

  it('selects the correct UTC Scheduler run before and after DST', () => {
    expect(
      isQuestionGenerationHour(
        new Date('2026-07-28T05:00:00.000Z'),
        'America/Chicago',
      ),
    ).toBe(true);
    expect(
      isQuestionGenerationHour(
        new Date('2026-07-28T06:00:00.000Z'),
        'America/Chicago',
      ),
    ).toBe(false);
    expect(
      isQuestionGenerationHour(
        new Date('2026-12-15T05:00:00.000Z'),
        'America/Chicago',
      ),
    ).toBe(false);
    expect(
      isQuestionGenerationHour(
        new Date('2026-12-15T06:00:00.000Z'),
        'America/Chicago',
      ),
    ).toBe(true);
  });

  it('moves across real calendar days', () => {
    expect(previousQuestionDay('2026-03-01')).toBe('2026-02-28');
    expect(previousQuestionDay('2024-03-01')).toBe('2024-02-29');
    expect(nextQuestionDay('2026-02-28')).toBe('2026-03-01');
    expect(nextQuestionDay('2024-02-28')).toBe('2024-02-29');
  });

  it('finds local midnight in distant and fractional-offset zones', () => {
    expect(
      dailyQuestionUnlockAt('2026-07-30', 'America/Los_Angeles').toISOString(),
    ).toBe('2026-07-31T07:00:00.000Z');
    expect(
      dailyQuestionUnlockAt('2026-07-30', 'Asia/Tokyo').toISOString(),
    ).toBe('2026-07-30T15:00:00.000Z');
    expect(
      dailyQuestionUnlockAt('2026-07-30', 'Asia/Kathmandu').toISOString(),
    ).toBe('2026-07-30T18:15:00.000Z');
  });

  it('uses the offset in effect after DST changes', () => {
    expect(
      dailyQuestionUnlockAt('2026-03-08', 'America/New_York').toISOString(),
    ).toBe('2026-03-09T04:00:00.000Z');
    expect(
      dailyQuestionUnlockAt('2026-11-01', 'America/New_York').toISOString(),
    ).toBe('2026-11-02T05:00:00.000Z');
  });

  it('canonicalizes and rejects IANA time zones', () => {
    expect(canonicalTimeZone('America/Chicago')).toBe('America/Chicago');
    expect(() => canonicalTimeZone('Not/A_Zone')).toThrow(
      'Time zone must be a valid IANA time zone.',
    );
  });
});

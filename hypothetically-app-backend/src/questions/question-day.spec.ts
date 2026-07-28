import {
  previousQuestionDay,
  questionDayKey,
  requiredAnswerCount,
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

  it('moves backward by calendar day and validates thresholds', () => {
    expect(previousQuestionDay('2026-03-01')).toBe('2026-02-28');
    expect(previousQuestionDay('2024-03-01')).toBe('2024-02-29');
    expect(requiredAnswerCount(0)).toBe(1);
    expect(requiredAnswerCount(1)).toBe(1);
    expect(requiredAnswerCount(10)).toBe(2);
    expect(requiredAnswerCount(11)).toBe(3);
  });
});

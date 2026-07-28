import {
  GeneratedQuestionSchema,
  normalizedTokenSimilarity,
  validateGeneratedQuestion,
} from './question-candidate';

const VALID_CANDIDATE = {
  prompt: 'How many soap bubbles could cover the surface of your bathtub?',
  unit: 'bubbles',
  answerStyle: 'whole' as const,
  maximum: 10_000_000,
};

describe('generated question validation', () => {
  it('requires usable structured numeric fields', () => {
    expect(GeneratedQuestionSchema.safeParse(VALID_CANDIDATE).success).toBe(
      true,
    );
    expect(
      GeneratedQuestionSchema.safeParse({
        ...VALID_CANDIDATE,
        maximum: 10.5,
      }).success,
    ).toBe(false);
    expect(
      GeneratedQuestionSchema.safeParse({
        ...VALID_CANDIDATE,
        answerStyle: 'currency',
      }).success,
    ).toBe(false);
    expect(
      GeneratedQuestionSchema.safeParse({
        ...VALID_CANDIDATE,
        maximum: 1_000_000_001,
      }).success,
    ).toBe(false);
  });

  it('enforces safe wording and normalized similarity below 0.60', () => {
    expect(validateGeneratedQuestion(VALID_CANDIDATE, [])).toBeUndefined();
    expect(
      validateGeneratedQuestion(
        {
          ...VALID_CANDIDATE,
          prompt: 'How many dollars of debt do you carry?',
        },
        [],
      ),
    ).toContain('sensitive');
    expect(
      validateGeneratedQuestion(VALID_CANDIDATE, [
        'How many bubbles could cover your bathtub surface?',
      ]),
    ).toContain('too similar');
    expect(
      normalizedTokenSimilarity(
        VALID_CANDIDATE.prompt,
        'How many stars might fit across the night sky?',
      ),
    ).toBeLessThan(0.6);
  });
});

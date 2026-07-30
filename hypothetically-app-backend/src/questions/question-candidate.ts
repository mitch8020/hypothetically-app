import { z } from 'zod';

export const MAXIMUM_GENERATED_ANSWER = 1_000_000_000;

export const GeneratedQuestionSchema = z.object({
  prompt: z.string().min(20).max(280),
  unit: z.string().min(1).max(40),
  answerStyle: z.literal('whole'),
  maximum: z.number().int().min(10).max(MAXIMUM_GENERATED_ANSWER),
});

export type GeneratedQuestionCandidate = z.infer<
  typeof GeneratedQuestionSchema
>;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'could',
  'do',
  'how',
  'in',
  'many',
  'of',
  'the',
  'think',
  'to',
  'would',
  'you',
  'your',
]);

const FORBIDDEN_TOPIC_PATTERN =
  /\b(politic|religion|sexual|suicide|murder|weapon|illegal|diagnos|disabil|race|ethnic|salary|debt|grief|death)\w*/i;

function normalizedTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token && !STOP_WORDS.has(token)),
  );
}

export function normalizedTokenSimilarity(left: string, right: string): number {
  const leftTokens = normalizedTokens(left);
  const rightTokens = normalizedTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 1;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return intersection / union.size;
}

export function validateGeneratedQuestion(
  candidate: GeneratedQuestionCandidate,
  avoidedPrompts: string[],
): string | undefined {
  const parsed = GeneratedQuestionSchema.safeParse(candidate);
  if (!parsed.success) {
    return 'The structured numeric fields did not pass validation.';
  }

  const prompt = parsed.data.prompt.trim();
  const unit = parsed.data.unit.trim();
  if (!/^How many\b.*\?$/i.test(prompt)) {
    return 'The prompt must be a 20-280 character “How many” question.';
  }
  if (FORBIDDEN_TOPIC_PATTERN.test(prompt)) {
    return 'The prompt touched a disallowed sensitive topic.';
  }
  if (/[.!?]/.test(unit)) {
    return 'The unit must be a short plain label.';
  }
  const closestSimilarity = avoidedPrompts.reduce(
    (highest, avoided) =>
      Math.max(highest, normalizedTokenSimilarity(prompt, avoided)),
    0,
  );
  if (closestSimilarity >= 0.6) {
    return 'The prompt was too similar to an example or recent question.';
  }
  return undefined;
}

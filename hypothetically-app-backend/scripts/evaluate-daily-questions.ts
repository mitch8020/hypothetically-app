import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { QUESTION_CATALOG } from '../src/questions/question.catalog';
import {
  GeneratedQuestionSchema,
  validateGeneratedQuestion,
} from '../src/questions/question-candidate';
import {
  GPT_QUESTION_MODEL,
  QuestionGenerationService,
} from '../src/questions/question-generation.service';

const CANDIDATE_COUNT = 10;

async function evaluate(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not configured. The gated live evaluation was not run.',
    );
  }

  const generator = new QuestionGenerationService(
    new ConfigService({ OPENAI_API_KEY: apiKey }),
  );
  const generatedPrompts: string[] = [];
  const catalogPrompts = QUESTION_CATALOG.map((question) => question.prompt);

  for (let index = 0; index < CANDIDATE_COUNT; index += 1) {
    const dayKey = `2030-01-${String(index + 1).padStart(2, '0')}`;
    const generated = await generator.generate(dayKey, generatedPrompts);
    const parsed = GeneratedQuestionSchema.safeParse(generated.candidate);
    if (!parsed.success) {
      throw new Error(
        `Candidate ${index + 1} failed the Structured Output schema.`,
      );
    }
    const rejection = validateGeneratedQuestion(parsed.data, [
      ...catalogPrompts,
      ...generatedPrompts,
    ]);
    if (rejection) {
      throw new Error(`Candidate ${index + 1} was rejected: ${rejection}`);
    }

    const step = parsed.data.answerStyle === 'whole' ? 1 : 0.1;
    if (parsed.data.maximum / step < 10) {
      throw new Error(
        `Candidate ${index + 1} does not provide a usable numerical range.`,
      );
    }
    generatedPrompts.push(parsed.data.prompt);
    console.log(
      `${index + 1}. ${parsed.data.prompt} [${parsed.data.unit}; ${parsed.data.answerStyle}; max ${parsed.data.maximum.toLocaleString('en-US')}]`,
    );
  }

  console.log(
    `PASS: ${CANDIDATE_COUNT} ${GPT_QUESTION_MODEL} candidates passed schema, numerical usability, safety, and non-duplication gates.`,
  );
}

void evaluate().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown live evaluation failure.';
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
});

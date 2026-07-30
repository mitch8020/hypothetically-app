import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { QUESTION_CATALOG } from './question.catalog';
import {
  GeneratedQuestionCandidate,
  GeneratedQuestionSchema,
} from './question-candidate';

export const GPT_QUESTION_MODEL = 'gpt-5.6-luna';
export const QUESTION_PROMPT_VERSION = 'daily-question-v1';

export interface GeneratedQuestion {
  candidate: GeneratedQuestionCandidate;
  model: string;
  responseId: string;
}

const GOOD_QUESTION_EXAMPLES = [
  { question: QUESTION_CATALOG[0] },
  { question: QUESTION_CATALOG[1] },
  { question: QUESTION_CATALOG[2] },
  { question: QUESTION_CATALOG[5] },
  { question: QUESTION_CATALOG[8] },
  { question: QUESTION_CATALOG[11] },
  { question: QUESTION_CATALOG[15] },
  { question: QUESTION_CATALOG[16] },
  { question: QUESTION_CATALOG[17] },
  { question: QUESTION_CATALOG[19] },
  { question: QUESTION_CATALOG[20] },
  { question: QUESTION_CATALOG[23] },
] as const;

function examplesForPrompt(): string {
  return GOOD_QUESTION_EXAMPLES.map(({ question }) => {
    const answerStyle = 'whole';
    const maximum = 1_000_000_000;
    return `- ${question.prompt} | unit=${question.unit} | answerStyle=${answerStyle} | maximum=${maximum}`;
  }).join('\n');
}

@Injectable()
export class QuestionGenerationService {
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      maxRetries: 0,
      timeout: 30_000,
    });
  }

  async generate(
    dayKey: string,
    recentPrompts: string[],
    rejectionReason?: string,
  ): Promise<GeneratedQuestion> {
    const avoidList =
      recentPrompts.length === 0
        ? '- No prior generated questions yet.'
        : recentPrompts.map((prompt) => `- ${prompt}`).join('\n');
    const retryContext = rejectionReason
      ? `\nThe previous candidate was rejected because: ${rejectionReason}\nCreate a materially different candidate.`
      : '';

    const response = await this.client.responses.parse({
      model: GPT_QUESTION_MODEL,
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 1_200,
      input: [
        {
          role: 'developer',
          content: [
            'Create one playful numeric estimation question for the public game "How Many?".',
            'The question must begin with "How many", end with a question mark, and invite an ambiguous and non-deterministic estimate rather than have one factual correct answer.',
            'Make it understandable without specialist knowledge and suitable for a broad, general audience.',
            'Avoid politics, religion, violence, illegal activity, health diagnoses, protected traits, personal finances, grief, shame, and requests for sensitive personal information.',
            'Use a short lowercase unit. Choose "whole" always.',
            'Do not copy or closely paraphrase an example or recent question.',
            '',
            'Good examples:',
            examplesForPrompt(),
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Create the question for ${dayKey}.`,
            '',
            'Recent questions to avoid:',
            avoidList,
            retryContext,
          ].join('\n'),
        },
      ],
      text: {
        verbosity: 'low',
        format: zodTextFormat(
          GeneratedQuestionSchema,
          'daily_numeric_question',
        ),
      },
    });

    if (!response.output_parsed) {
      throw new Error('OPENAI_EMPTY_STRUCTURED_OUTPUT');
    }

    return {
      candidate: response.output_parsed,
      model: response.model,
      responseId: response.id,
    };
  }
}

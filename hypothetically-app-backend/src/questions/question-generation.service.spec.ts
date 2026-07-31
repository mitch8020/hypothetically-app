import { ConfigService } from '@nestjs/config';
import { QuestionGenerationService } from './question-generation.service';

interface OpenAIClientHarness {
  responses: {
    parse: jest.Mock;
  };
}

describe('QuestionGenerationService', () => {
  const parse = jest.fn();
  let service: QuestionGenerationService;

  beforeEach(() => {
    parse.mockReset();
    service = new QuestionGenerationService({
      getOrThrow: jest.fn().mockReturnValue('test-openai-key'),
    } as unknown as ConfigService);
    (
      service as unknown as {
        client: OpenAIClientHarness;
      }
    ).client = { responses: { parse } };
  });

  it('uses Luna with low reasoning and Zod-backed Structured Outputs', async () => {
    parse.mockResolvedValue({
      id: 'resp_test',
      model: 'gpt-5.6-luna',
      output_parsed: {
        prompt:
          'How many soap bubbles could cover the surface of your bathtub?',
        unit: 'bubbles',
        answerStyle: 'whole',
        maximum: 10_000_000,
      },
    });

    await expect(
      service.generate('2026-07-28', ['How many old prompts?']),
    ).resolves.toMatchObject({
      model: 'gpt-5.6-luna',
      responseId: 'resp_test',
    });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'low' },
        store: false,
        text: expect.objectContaining({
          verbosity: 'low',
          format: expect.any(Object),
        }),
      }),
    );
    const input = String(parse.mock.calls[0][0].input[1].content);
    expect(input).toContain('- How many old prompts?');
  });

  it('includes the rejection context when retrying after a candidate failure', async () => {
    parse.mockResolvedValue({
      id: 'resp_retry',
      model: 'gpt-5.6-luna',
      output_parsed: {
        prompt:
          'How many soap bubbles could cover the surface of your bathtub?',
        unit: 'bubbles',
        answerStyle: 'whole',
        maximum: 10_000_000,
      },
    });

    await service.generate('2026-07-28', [], 'The previous wording was too close.');
    const input = String(parse.mock.calls[0][0].input[1].content);
    expect(input).toContain('The previous wording was too close.');
    expect(input).toContain('- No prior generated questions yet.');
  });

  it('treats a refusal or missing parsed output as a generation failure', async () => {
    parse.mockResolvedValue({
      id: 'resp_refusal',
      model: 'gpt-5.6-luna',
      output_parsed: null,
      output: [
        {
          type: 'message',
          content: [{ type: 'refusal', refusal: 'Unable to provide that.' }],
        },
      ],
    });

    await expect(service.generate('2026-07-28', [])).rejects.toThrow(
      'OPENAI_EMPTY_STRUCTURED_OUTPUT',
    );
  });
});

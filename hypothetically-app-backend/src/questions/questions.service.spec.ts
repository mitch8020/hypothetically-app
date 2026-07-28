import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { QUESTION_CATALOG } from './question.catalog';
import { QuestionGenerationService } from './question-generation.service';
import { QuestionResult, UnlockedQuestionResult } from './question.types';
import { QuestionsModule } from './questions.module';
import { QuestionsService } from './questions.service';
import { Answer } from './schemas/answer.schema';
import { DailyVisit } from './schemas/daily-visit.schema';
import { Question } from './schemas/question.schema';
import { QuestionGeneration } from './schemas/question-generation.schema';

function assertUnlocked(
  result: QuestionResult,
): asserts result is UnlockedQuestionResult {
  expect(result.status).toBe('unlocked');
  if (result.status !== 'unlocked') {
    throw new Error('Expected an unlocked question result.');
  }
}

describe('QuestionsService integration', () => {
  let mongo: MongoMemoryServer;
  let module: TestingModule;
  let service: QuestionsService;
  let usersService: UsersService;
  let answerModel: Model<Answer>;
  let questionModel: Model<Question>;
  let visitModel: Model<DailyVisit>;
  let generationModel: Model<QuestionGeneration>;
  let userModel: Model<User>;
  const generate = jest.fn();

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              SESSION_SECRET: 'test-session-secret-at-least-32-characters',
              OPENAI_API_KEY: 'test-openai-key',
              APP_TIME_ZONE: 'America/Chicago',
              GOOGLE_CLIENT_ID: 'test-google-client',
              GOOGLE_CLIENT_SECRET: 'test-google-secret',
              GOOGLE_CALLBACK_URL:
                'http://localhost:7000/api/auth/google/callback',
            }),
          ],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        UsersModule,
        AuthModule,
        QuestionsModule,
      ],
    })
      .overrideProvider(QuestionGenerationService)
      .useValue({ generate })
      .compile();
    await module.init();

    service = module.get(QuestionsService);
    usersService = module.get(UsersService);
    answerModel = module.get(getModelToken(Answer.name));
    questionModel = module.get(getModelToken(Question.name));
    visitModel = module.get(getModelToken(DailyVisit.name));
    generationModel = module.get(getModelToken(QuestionGeneration.name));
    userModel = module.get(getModelToken(User.name));
    await Promise.all([
      answerModel.syncIndexes(),
      questionModel.syncIndexes(),
      visitModel.syncIndexes(),
      generationModel.syncIndexes(),
      userModel.syncIndexes(),
    ]);
  }, 120_000);

  afterAll(async () => {
    await module.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    generate.mockReset();
    generate.mockResolvedValue({
      candidate: {
        prompt:
          'How many raindrops could land on your umbrella during a summer storm?',
        unit: 'raindrops',
        answerStyle: 'whole',
        maximum: 1_000_000,
      },
      model: 'gpt-5.6-luna',
      responseId: 'resp_test',
    });
    await Promise.all([
      answerModel.deleteMany({}),
      questionModel.deleteMany({}),
      visitModel.deleteMany({}),
      generationModel.deleteMany({}),
      userModel.deleteMany({}),
    ]);
    await questionModel.insertMany(
      QUESTION_CATALOG.map((question) => ({
        ...question,
        source: 'catalog',
        requiredAnswerCount: 1,
      })),
    );
  });

  async function makeUser(
    subject: string,
    firstName: string,
    lastInitial: string,
  ): Promise<Express.User> {
    return usersService.upsertGoogleProfile({
      googleSubject: subject,
      firstName,
      lastInitial,
    });
  }

  it('keeps legacy catalog questions public and immediately unlockable', async () => {
    const question = await service.findPublicQuestion('doors-opened');
    expect(question).toEqual({
      key: 'doors-opened',
      prompt: 'How many doors do you think you’ve opened in your lifetime?',
      unit: 'doors',
      minimum: 0,
      maximum: 1_000_000_000,
      step: 1,
      precision: 0,
    });

    const user = await makeUser('legacy', 'Legacy', 'L');
    const result = await service.submitAnswer('doors-opened', user, 10);
    assertUnlocked(result);
    expect(result.average).toBe(10);
  });

  it('generates one Central-time question and snapshots one-fifth of prior traffic', async () => {
    await visitModel.insertMany(
      Array.from({ length: 11 }, (_, index) => ({
        dayKey: '2026-07-27',
        visitorHash: `visitor-${index}`,
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    );

    const now = new Date('2026-07-28T12:00:00.000Z');
    const first = await service.findTodayQuestion(now);
    const second = await service.findTodayQuestion(now);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      key: 'daily-2026-07-28',
      dayKey: '2026-07-28',
      precision: 0,
      step: 1,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(
      questionModel.findOne({ dayKey: '2026-07-28' }).lean().exec(),
    ).resolves.toMatchObject({
      requiredAnswerCount: 3,
      generationModel: 'gpt-5.6-luna',
      promptVersion: 'daily-question-v1',
    });

    await visitModel.insertMany(
      Array.from({ length: 20 }, (_, index) => ({
        dayKey: '2026-07-27',
        visitorHash: `late-visitor-${index}`,
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    );
    await service.findTodayQuestion(now);
    await expect(
      questionModel.findOne({ dayKey: '2026-07-28' }).lean().exec(),
    ).resolves.toMatchObject({ requiredAnswerCount: 3 });
  });

  it('rejects a copied example and retries with a distinct candidate', async () => {
    generate
      .mockResolvedValueOnce({
        candidate: {
          prompt: QUESTION_CATALOG[0].prompt,
          unit: 'doors',
          answerStyle: 'whole',
          maximum: 1_000_000,
        },
        model: 'gpt-5.6-luna',
        responseId: 'resp_too_similar',
      })
      .mockResolvedValueOnce({
        candidate: {
          prompt:
            'How many soap bubbles could cover the surface of your bathtub?',
          unit: 'bubbles',
          answerStyle: 'whole',
          maximum: 10_000_000,
        },
        model: 'gpt-5.6-luna',
        responseId: 'resp_distinct',
      });

    await expect(
      service.findTodayQuestion(new Date('2026-07-28T12:00:00.000Z')),
    ).resolves.toMatchObject({
      prompt: 'How many soap bubbles could cover the surface of your bathtub?',
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][2]).toContain('too similar');
  });

  it('allows one generation lease holder and retries failures after cooldown', async () => {
    let releaseGeneration:
      | ((value: {
          candidate: {
            prompt: string;
            unit: string;
            answerStyle: 'whole';
            maximum: number;
          };
          model: string;
          responseId: string;
        }) => void)
      | undefined;
    generate.mockReset();
    generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseGeneration = resolve;
        }),
    );
    const now = new Date('2026-07-28T12:00:00.000Z');
    const firstRequest = service.findTodayQuestion(now);
    while (generate.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await expect(service.findTodayQuestion(now)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DAILY_QUESTION_PENDING',
      }),
    });
    releaseGeneration?.({
      candidate: {
        prompt:
          'How many soap bubbles could cover the surface of your bathtub?',
        unit: 'bubbles',
        answerStyle: 'whole',
        maximum: 10_000_000,
      },
      model: 'gpt-5.6-luna',
      responseId: 'resp_lease',
    });
    await expect(firstRequest).resolves.toMatchObject({
      key: 'daily-2026-07-28',
    });

    await questionModel.deleteMany({});
    await generationModel.deleteMany({});
    generate.mockReset();
    generate.mockRejectedValue(new Error('OPENAI_TIMEOUT'));
    await expect(service.findTodayQuestion(now)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DAILY_QUESTION_PENDING',
        retryAfterSeconds: 60,
      }),
    });
    expect(generate).toHaveBeenCalledTimes(2);
    await expect(
      generationModel.findOne({ dayKey: '2026-07-28' }).lean().exec(),
    ).resolves.toMatchObject({
      status: 'failed',
      lastErrorCode: 'OPENAI_TIMEOUT',
    });

    generate.mockReset();
    generate.mockResolvedValue({
      candidate: {
        prompt:
          'How many soap bubbles could cover the surface of your bathtub?',
        unit: 'bubbles',
        answerStyle: 'whole',
        maximum: 10_000_000,
      },
      model: 'gpt-5.6-luna',
      responseId: 'resp_retry',
    });
    await expect(
      service.findTodayQuestion(new Date('2026-07-28T12:01:01.000Z')),
    ).resolves.toMatchObject({ key: 'daily-2026-07-28' });
  });

  it('hides aggregates until the immutable answer target is reached', async () => {
    await visitModel.insertMany(
      Array.from({ length: 11 }, (_, index) => ({
        dayKey: '2026-07-27',
        visitorHash: `threshold-${index}`,
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    );
    await service.findTodayQuestion(new Date('2026-07-28T12:00:00.000Z'));
    const alex = await makeUser('alex', 'Alex', 'A');
    const blair = await makeUser('blair', 'Blair', 'B');
    const casey = await makeUser('casey', 'Casey', 'C');

    const first = await service.submitAnswer('daily-2026-07-28', alex, 10);
    expect(first).toEqual(
      expect.objectContaining({
        status: 'locked',
        userAnswer: 10,
        answerCount: 1,
        requiredAnswerCount: 3,
        remainingAnswerCount: 2,
      }),
    );
    expect(first).not.toHaveProperty('average');
    expect(first).not.toHaveProperty('leaders');

    await service.submitAnswer('daily-2026-07-28', blair, 20);
    const unlocked = await service.submitAnswer('daily-2026-07-28', casey, 100);
    assertUnlocked(unlocked);
    expect(unlocked.average).toBeCloseTo(43.333333, 5);
    expect(unlocked.answerCount).toBe(3);
    expect(unlocked.winningEntry).toMatchObject({
      rank: 1,
      displayName: 'Blair B.',
      value: 20,
    });
    expect(unlocked.userEntry).toMatchObject({
      rank: 3,
      displayName: 'Casey C.',
      value: 100,
      isCurrentUser: true,
      distanceToWinner: 80,
    });
  });

  it('locks the first answer and validates numeric precision', async () => {
    const user = await makeUser('precision', 'Precise', 'P');
    await expect(
      service.submitAnswer('doors-opened', user, 2.5),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_PRECISION' }),
    });
    await expect(
      service.submitAnswer('one-foot-balance', user, 3600.1),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ANSWER_OUT_OF_RANGE' }),
    });

    const result = await service.submitAnswer('one-foot-balance', user, 12.3);
    assertUnlocked(result);
    expect(result.userEntry.value).toBe(12.3);
    await expect(
      service.submitAnswer('one-foot-balance', user, 12.4),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ANSWER_ALREADY_SUBMITTED' }),
    });
  });

  it('gives equal distances the same rank and pins users outside the top five', async () => {
    const values = [0, 1, 2, 3, 4, 100];
    const users = await Promise.all(
      values.map((_, index) => makeUser(`pin-${index}`, `Player${index}`, 'P')),
    );
    for (let index = 0; index < users.length; index += 1) {
      await service.submitAnswer(
        'paper-airplanes',
        users[index],
        values[index],
      );
    }

    const result = await service.getResult('paper-airplanes', users[5]);
    assertUnlocked(result);
    expect(result.leaders).toHaveLength(5);
    expect(result.leaders.some((entry) => entry.isCurrentUser)).toBe(false);
    expect(result.userEntry.rank).toBe(6);

    const left = await makeUser('left', 'Left', 'L');
    const right = await makeUser('right', 'Right', 'R');
    await service.submitAnswer('dogs-petted', left, 0);
    const tied = await service.submitAnswer('dogs-petted', right, 10);
    assertUnlocked(tied);
    expect(tied.leaders.map((entry) => entry.rank)).toEqual([1, 1]);
  });

  it('walks backward to the nearest unanswered GPT question only', async () => {
    const user = await makeUser('backlog', 'Backlog', 'B');
    await questionModel.insertMany([
      {
        ...QUESTION_CATALOG[0],
        key: 'daily-2026-07-26',
        dayKey: '2026-07-26',
        source: 'gpt',
        requiredAnswerCount: 1,
      },
      {
        ...QUESTION_CATALOG[1],
        key: 'daily-2026-07-27',
        dayKey: '2026-07-27',
        source: 'gpt',
        requiredAnswerCount: 1,
      },
    ]);
    await service.submitAnswer('daily-2026-07-27', user, 5);

    await expect(
      service.findPreviousUnansweredQuestion(user, '2026-07-28'),
    ).resolves.toMatchObject({ key: 'daily-2026-07-26' });
  });

  it('hides results before the current user answers', async () => {
    const user = await makeUser('hidden', 'Hidden', 'H');
    await expect(service.getResult('doors-opened', user)).rejects.toMatchObject(
      {
        response: expect.objectContaining({ code: 'ANSWER_REQUIRED' }),
      },
    );
  });
});

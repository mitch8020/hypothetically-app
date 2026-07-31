import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { QuestionsService } from './questions.service';

function chain<T>(value: T) {
  const query = {
    exec: jest.fn().mockResolvedValue(value),
    lean: jest.fn(),
    limit: jest.fn(),
    populate: jest.fn(),
    select: jest.fn(),
    sort: jest.fn(),
  };
  query.lean.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.populate.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  return query;
}

function makeService(values: Record<string, unknown> = {}) {
  const questionModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const answerModel = {
    create: jest.fn(),
    distinct: jest.fn(),
    exists: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
  };
  const generationModel = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const generator = { generate: jest.fn() };
  const service = new QuestionsService(
    questionModel as never,
    answerModel as never,
    generationModel as never,
    generator as never,
    {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService,
  );
  return { service, questionModel, answerModel, generationModel, generator };
}

const question = {
  _id: new Types.ObjectId(),
  key: 'daily-test',
  prompt: 'How many things could fit in a room?',
  unit: 'things',
  minimum: 0,
  maximum: 100,
  step: 1,
  precision: 0,
  active: true,
  dayKey: '2026-07-28',
  source: 'gpt',
};

describe('QuestionsService defensive coverage', () => {
  afterEach(() => {
    delete process.env.DAILY_QUESTION_SCHEDULER_RUN;
  });

  it('covers bootstrap guards, scheduler forcing, and default arguments', async () => {
    const { service } = makeService();
    const ensure = jest
      .spyOn(service as never, 'ensureTodayQuestion' as never)
      .mockResolvedValue(question as never);

    process.env.DAILY_QUESTION_SCHEDULER_RUN = 'true';
    service.onApplicationBootstrap();
    expect(ensure).not.toHaveBeenCalled();

    process.env.DAILY_QUESTION_SCHEDULER_RUN = 'false';
    ensure.mockRejectedValueOnce('unknown bootstrap failure');
    service.onApplicationBootstrap();
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      service.generateFromScheduler(
        new Date('2026-07-28T06:00:00.000Z'),
        true,
      ),
    ).resolves.toMatchObject({
      status: 'ready',
      question: { key: 'daily-test', dayKey: '2026-07-28' },
    });
    await expect(service.generateFromScheduler()).resolves.toMatchObject({
      status: 'skipped',
    });
    await expect(service.findTodayQuestion()).resolves.toMatchObject({
      key: 'daily-test',
    });
    const user = { _id: new Types.ObjectId() } as Express.User;
    const {
      service: randomService,
      answerModel,
      questionModel,
    } = makeService();
    answerModel.distinct.mockReturnValueOnce(chain([]));
    questionModel.find.mockReturnValueOnce(chain([question]));
    await expect(
      randomService.findRandomQuestion(user),
    ).resolves.toMatchObject({
      key: 'daily-test',
    });
  });

  it('covers random selection and archive filters', async () => {
    const { service, answerModel, questionModel } = makeService({
      APP_TIME_ZONE: 'America/Chicago',
      NODE_ENV: 'test',
    });
    const user = { _id: new Types.ObjectId() } as Express.User;
    const catalogQuestion = {
      ...question,
      _id: new Types.ObjectId(),
      key: 'doors-opened',
      dayKey: undefined,
      source: 'catalog',
    };
    answerModel.distinct
      .mockReturnValueOnce(chain([catalogQuestion._id]))
      .mockReturnValueOnce(chain([]));
    questionModel.find
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([question, catalogQuestion]));
    await expect(
      service.findRandomQuestion(user, 'daily-test'),
    ).resolves.toBeNull();
    await expect(service.findRandomQuestion(user)).resolves.toMatchObject({
      key: expect.any(String),
    });

    answerModel.find.mockReturnValue(chain([{ question: catalogQuestion._id }]));
    questionModel.find.mockReturnValue(chain([question, catalogQuestion]));
    await expect(
      service.findArchive(
        user,
        undefined,
        undefined,
        new Date('2026-07-31T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ total: 2 });
    await expect(
      service.findArchive(
        user,
        'answered',
        'everyday',
        new Date('2026-07-31T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      service.findArchive(
        user,
        'unanswered',
        'sports',
        new Date('2026-07-31T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ total: 0 });
    await expect(service.findArchive(user, 'bad-status')).rejects.toMatchObject({
      response: { code: 'INVALID_ARCHIVE_STATUS' },
    });
    await expect(service.findArchive(user, 'all', 'bad-topic')).rejects.toMatchObject({
      response: { code: 'INVALID_ARCHIVE_TOPIC' },
    });
  });

  it('covers unanswered-query branches, invalid dates, and missing questions', async () => {
    const { service, answerModel, questionModel } = makeService();
    const user = { _id: new Types.ObjectId() } as Express.User;
    answerModel.distinct.mockReturnValueOnce(chain([]));
    questionModel.findOne.mockReturnValueOnce(chain(null));
    await expect(service.findPreviousUnansweredQuestion(user)).resolves.toBeNull();

    answerModel.distinct.mockReturnValueOnce(chain([new Types.ObjectId()]));
    questionModel.findOne.mockReturnValueOnce(chain(question));
    await expect(
      service.findPreviousUnansweredQuestion(user, '2026-07-29'),
    ).resolves.toMatchObject({ key: 'daily-test' });

    await expect(
      service.findPreviousUnansweredQuestion(user, 'not-a-day'),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DAY_KEY' } });

    questionModel.findOne.mockReturnValueOnce(chain(null));
    await expect(service.findPublicQuestion('missing')).rejects.toMatchObject({
      response: { code: 'QUESTION_NOT_FOUND' },
    });
  });

  it('returns a question completed by another lease holder', async () => {
    const { service, questionModel } = makeService({
      APP_TIME_ZONE: 'America/Chicago',
      NODE_ENV: 'test',
    });
    questionModel.findOne
      .mockReturnValueOnce(chain(null))
      .mockReturnValueOnce(chain(question));
    jest
      .spyOn(service as never, 'acquireGenerationLease' as never)
      .mockResolvedValue(false as never);
    await expect(
      (service as unknown as Record<string, Function>).ensureTodayQuestion(
        new Date('2026-07-28T12:00:00.000Z'),
      ),
    ).resolves.toEqual(question);
  });

  it('passes recent generated prompts into the next candidate request', async () => {
    const { service, questionModel, generationModel, generator } = makeService({
      APP_TIME_ZONE: 'America/Chicago',
      NODE_ENV: 'test',
    });
    questionModel.findOne.mockReturnValueOnce(chain(null));
    questionModel.find.mockReturnValueOnce(chain([{ prompt: 'A recent prompt' }]));
    jest
      .spyOn(service as never, 'acquireGenerationLease' as never)
      .mockResolvedValue(true as never);
    jest
      .spyOn(service as never, 'createGeneratedQuestion' as never)
      .mockResolvedValue(question as never);
    generationModel.updateOne.mockReturnValueOnce(chain(undefined));
    generator.generate.mockResolvedValue({
      candidate: {
        prompt: 'How many new things could fit in a room?',
        unit: 'things',
        answerStyle: 'whole',
        maximum: 100,
      },
      model: 'test-model',
      responseId: 'response-id',
    });

    await expect(
      (service as unknown as Record<string, Function>).ensureTodayQuestion(
        new Date('2026-07-28T12:00:00.000Z'),
      ),
    ).resolves.toEqual(question);
    expect(generator.generate).toHaveBeenCalledWith(
      '2026-07-28',
      ['A recent prompt'],
      undefined,
    );
  });

  it('covers generation lease and generated-question persistence failures', async () => {
    const { service, questionModel, generationModel } = makeService();
    generationModel.findOneAndUpdate.mockReturnValue(chain(null));
    generationModel.create.mockRejectedValueOnce(new Error('database down'));
    await expect(
      (service as unknown as Record<string, Function>).acquireGenerationLease(
        '2026-07-28',
        new Date('2026-07-28T00:00:00.000Z'),
      ),
    ).rejects.toThrow('database down');

    const generated = {
      candidate: {
        prompt: 'How many things could fit in a room?',
        unit: 'things',
        answerStyle: 'tenths',
        maximum: 100,
      },
      model: 'test-model',
      responseId: 'response-id',
    };
    const storedQuestion = { ...question, step: 0.1, precision: 1 };
    questionModel.create.mockResolvedValueOnce(storedQuestion);
    await expect(
      (service as unknown as Record<string, Function>).createGeneratedQuestion(
        '2026-07-28',
        generated,
      ),
    ).resolves.toEqual(storedQuestion);

    questionModel.create.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      (service as unknown as Record<string, Function>).createGeneratedQuestion(
        '2026-07-28',
        generated,
      ),
    ).rejects.toThrow('write failed');

    questionModel.create.mockRejectedValueOnce({ code: 11000 });
    questionModel.findOne.mockReturnValueOnce(chain(null));
    await expect(
      (service as unknown as Record<string, Function>).createGeneratedQuestion(
        '2026-07-28',
        generated,
      ),
    ).rejects.toMatchObject({ code: 11000 });

    questionModel.create.mockRejectedValueOnce({ code: 11000 });
    questionModel.findOne.mockReturnValueOnce(chain(storedQuestion));
    await expect(
      (service as unknown as Record<string, Function>).createGeneratedQuestion(
        '2026-07-28',
        generated,
      ),
    ).resolves.toEqual(storedQuestion);
  });

  it('covers answer validation, timezone fallbacks, and incomplete result states', async () => {
    const { service, answerModel } = makeService({
      APP_TIME_ZONE: undefined,
      NODE_ENV: 'test',
    });
    const privateService = service as unknown as Record<string, Function>;
    expect(() => privateService.validateValue(question, Number.NaN)).toThrow(
      'Enter a real number.',
    );
    expect(() =>
      privateService.validateValue({ ...question, precision: 1, step: 0.1 }, 1.11),
    ).toThrow('Enter no more than 1 decimal place.');

    answerModel.updateOne.mockReturnValue(chain(undefined));
    answerModel.findById.mockReturnValue(chain(null));
    await expect(
      privateService.answerTimeZone(new Types.ObjectId(), undefined, 'UTC'),
    ).resolves.toBe('UTC');
    await expect(
      privateService.answerTimeZone(
        new Types.ObjectId(),
        'Not/A_Zone',
        'UTC',
      ),
    ).resolves.toBe('America/Chicago');

    answerModel.findOne.mockReturnValue(chain(null));
    await expect(
      privateService.buildResult(
        question,
        new Types.ObjectId(),
        'UTC',
        new Date('2026-07-28T12:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ response: { code: 'ANSWER_REQUIRED' } });
  });

  it('propagates non-duplicate answer persistence errors', async () => {
    const { service, questionModel, answerModel } = makeService({
      NODE_ENV: 'test',
      APP_TIME_ZONE: 'America/Chicago',
    });
    questionModel.findOne.mockReturnValue(chain(question));
    answerModel.create.mockRejectedValue(new Error('answer write failed'));
    await expect(
      service.submitAnswer(
        'daily-test',
        { _id: new Types.ObjectId() } as Express.User,
        10,
        'UTC',
      ),
    ).rejects.toThrow('answer write failed');
  });

  it('covers median tie-breaking and missing current-user results', async () => {
    const { service, answerModel } = makeService();
    const firstId = new Types.ObjectId();
    const secondId = new Types.ObjectId();
    const createdAt = new Date('2026-07-28T12:00:00.000Z');
    const answers = [
      {
        user: { _id: firstId, firstName: 'First', lastInitial: '' },
        value: 0,
        createdAt,
      },
      {
        user: { _id: secondId, firstName: 'Second', lastInitial: '' },
        value: 10,
        createdAt,
      },
    ];
    answerModel.find.mockReturnValue(chain(answers));
    await expect(
      (service as unknown as Record<string, Function>).buildUnlockedResult(
        question,
        firstId,
      ),
    ).resolves.toMatchObject({
      median: 5,
      answerCount: 2,
      answerClusters: [
        { center: 0, count: 1, minimum: 0, maximum: 0 },
        { center: 10, count: 1, minimum: 10, maximum: 10 },
      ],
      userEntry: { displayName: 'First' },
    });

    answerModel.find.mockReturnValue(chain(answers));
    await expect(
      (service as unknown as Record<string, Function>).buildUnlockedResult(
        question,
        new Types.ObjectId(),
      ),
    ).rejects.toMatchObject({ response: { code: 'ANSWER_REQUIRED' } });

    const clusteredAnswers = Array.from({ length: 9 }, (_, index) => ({
      user: {
        _id: new Types.ObjectId(),
        firstName: `Player${index}`,
        lastInitial: index === 0 ? '' : 'P',
        ...(index === 0 ? { avatarUrl: 'https://avatar.test/player' } : {}),
      },
      value: index * 130,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    }));
    answerModel.find.mockReturnValue(chain(clusteredAnswers));
    await expect(
      (service as unknown as Record<string, Function>).buildUnlockedResult(
        question,
        clusteredAnswers[0].user._id,
      ),
    ).resolves.toMatchObject({
      answerClusters: expect.arrayContaining([
        expect.objectContaining({ count: expect.any(Number) }),
      ]),
      userEntry: expect.objectContaining({
        avatarUrl: 'https://avatar.test/player',
      }),
    });
  });
});

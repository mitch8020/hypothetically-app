import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { AuthModule } from '../auth/auth.module';
import { QUESTION_CATALOG } from './question.catalog';
import { QuestionsModule } from './questions.module';
import { QuestionsService } from './questions.service';
import { Answer } from './schemas/answer.schema';
import { Question } from './schemas/question.schema';
import { User } from '../users/schemas/user.schema';

describe('QuestionsService integration', () => {
  let mongo: MongoMemoryServer;
  let module: TestingModule;
  let service: QuestionsService;
  let usersService: UsersService;
  let answerModel: Model<Answer>;
  let questionModel: Model<Question>;
  let userModel: Model<User>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
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
    }).compile();
    await module.init();

    service = module.get(QuestionsService);
    usersService = module.get(UsersService);
    answerModel = module.get(getModelToken(Answer.name));
    questionModel = module.get(getModelToken(Question.name));
    userModel = module.get(getModelToken(User.name));
    await Promise.all([
      answerModel.syncIndexes(),
      questionModel.syncIndexes(),
      userModel.syncIndexes(),
    ]);
  }, 120_000);

  afterAll(async () => {
    await module.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([answerModel.deleteMany({}), userModel.deleteMany({})]);
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

  it('upserts the complete original catalog and returns public fields only', async () => {
    expect(await questionModel.countDocuments()).toBe(24);

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
    expect(question).not.toHaveProperty('_id');
  });

  it('excludes the current question when selecting another random prompt', async () => {
    for (let index = 0; index < 12; index += 1) {
      const question = await service.findRandomQuestion(
        undefined,
        'doors-opened',
      );
      expect(question?.key).not.toBe('doors-opened');
    }
  });

  it('calculates the mean, ranks by distance, and locks the first answer', async () => {
    const alex = await makeUser('alex', 'Alex', 'A');
    const blair = await makeUser('blair', 'Blair', 'B');
    const casey = await makeUser('casey', 'Casey', 'C');

    await service.submitAnswer('doors-opened', alex, 10);
    await service.submitAnswer('doors-opened', blair, 20);
    await service.submitAnswer('doors-opened', casey, 100);

    const result = await service.getResult('doors-opened', alex);
    expect(result.average).toBeCloseTo(43.333333, 5);
    expect(result.answerCount).toBe(3);
    expect(result.winningEntry).toMatchObject({
      rank: 1,
      displayName: 'Blair B.',
      value: 20,
    });
    expect(result.userEntry).toMatchObject({
      rank: 2,
      displayName: 'Alex A.',
      value: 10,
      isCurrentUser: true,
      distanceToWinner: 10,
    });
    expect(result.leaders).toHaveLength(3);
    expect(result.leaders[0]).not.toHaveProperty('googleSubject');

    const repeated = await service.submitAnswer('doors-opened', alex, 10);
    expect(repeated.answerCount).toBe(3);
    await expect(
      service.submitAnswer('doors-opened', alex, 11),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ANSWER_ALREADY_SUBMITTED' }),
    });
  });

  it('validates each question’s range and precision', async () => {
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
    expect(result.userEntry.value).toBe(12.3);
  });

  it('gives equal distances the same rank', async () => {
    const left = await makeUser('left', 'Left', 'L');
    const right = await makeUser('right', 'Right', 'R');

    await service.submitAnswer('dogs-petted', left, 0);
    const result = await service.submitAnswer('dogs-petted', right, 10);

    expect(result.average).toBe(5);
    expect(result.leaders.map((entry) => entry.rank)).toEqual([1, 1]);
  });

  it('pins the current player result even when they are outside the top five', async () => {
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
    expect(result.leaders).toHaveLength(5);
    expect(result.leaders.some((entry) => entry.isCurrentUser)).toBe(false);
    expect(result.userEntry.rank).toBe(6);
  });

  it('hides results before answering and reports an exhausted catalog', async () => {
    const user = await makeUser('finisher', 'Finisher', 'F');
    await expect(service.getResult('doors-opened', user)).rejects.toMatchObject(
      {
        response: expect.objectContaining({ code: 'ANSWER_REQUIRED' }),
      },
    );

    for (const question of QUESTION_CATALOG) {
      await service.submitAnswer(question.key, user, question.minimum);
    }
    await expect(service.findRandomQuestion(user._id)).resolves.toBeNull();
  });
});

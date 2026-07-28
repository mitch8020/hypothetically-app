import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import passport from 'passport';
import request, { SuperAgentTest } from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/auth/auth.module';
import { QuestionsModule } from '../src/questions/questions.module';
import { QuestionGenerationService } from '../src/questions/question-generation.service';
import { DailyVisit } from '../src/questions/schemas/daily-visit.schema';
import { Question } from '../src/questions/schemas/question.schema';
import { mutationOriginGuard } from '../src/security/mutation-origin.middleware';
import { TestAuthController } from '../src/test-auth/test-auth.controller';
import { UsersModule } from '../src/users/users.module';

describe('How Many, Though? API (e2e)', () => {
  let mongo: MongoMemoryServer;
  let moduleFixture: TestingModule;
  let app: INestApplication<App>;
  let agent: SuperAgentTest;
  let sessionStore: MongoStore;
  let visitModel: Model<DailyVisit>;
  let questionModel: Model<Question>;
  let todayKey: string;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_TEST_AUTH = 'true';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.SESSION_SECRET = 'test-only-session-secret-that-is-long-enough';
    process.env.FRONTEND_URL = 'http://localhost:7073';
    process.env.GOOGLE_CALLBACK_URL =
      'http://localhost:7000/api/auth/google/callback';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.APP_TIME_ZONE = 'America/Chicago';

    moduleFixture = await Test.createTestingModule({
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
              FRONTEND_URL: 'http://localhost:7073',
              NODE_ENV: 'test',
              SESSION_SECRET: 'test-only-session-secret-that-is-long-enough',
              OPENAI_API_KEY: 'test-openai-key',
              APP_TIME_ZONE: 'America/Chicago',
            }),
          ],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        UsersModule,
        AuthModule,
        QuestionsModule,
      ],
      controllers: [AppController, TestAuthController],
      providers: [AppService],
    })
      .overrideProvider(QuestionGenerationService)
      .useValue({
        generate: jest.fn().mockResolvedValue({
          candidate: {
            prompt:
              'How many sidewalk cracks could you step over on a long walk?',
            unit: 'cracks',
            answerStyle: 'whole',
            maximum: 1_000_000,
          },
          model: 'gpt-5.6-luna',
          responseId: 'resp_e2e',
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    sessionStore = MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'test-sessions',
    });
    app.use(
      session({
        name: 'hmt.sid',
        secret: process.env.SESSION_SECRET,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
      }),
    );
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(mutationOriginGuard('http://localhost:7073'));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();
    visitModel = moduleFixture.get(getModelToken(DailyVisit.name));
    questionModel = moduleFixture.get(getModelToken(Question.name));
    agent = request.agent(app.getHttpServer());
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await sessionStore.close();
    await mongo.stop();
  });

  it('serves health and one generated question through today and the compatibility alias', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200).expect({
      status: 'ok',
      service: 'hypothetically-app-backend',
    });

    const response = await request(app.getHttpServer())
      .get('/api/questions/today')
      .expect(200)
      .expect('Cache-Control', /no-store/);
    expect(response.body).toEqual(
      expect.objectContaining({
        key: expect.stringMatching(/^daily-/),
        prompt: 'How many sidewalk cracks could you step over on a long walk?',
        unit: 'cracks',
        dayKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(response.body).not.toHaveProperty('_id');
    todayKey = response.body.key as string;

    await request(app.getHttpServer())
      .get('/api/questions/random?exclude=ignored')
      .expect(200)
      .expect((aliasResponse) => {
        expect(aliasResponse.body.key).toBe(todayKey);
      });
  });

  it('deduplicates valid browser visits and rejects a tampered identity cookie', async () => {
    const firstBrowser = request.agent(app.getHttpServer());
    const firstVisit = await firstBrowser
      .post('/api/traffic/visit')
      .set('Origin', 'http://localhost:7073')
      .expect(204);
    expect(firstVisit.headers['set-cookie']?.[0]).toMatch(
      /hmt\.vid=.*HttpOnly/,
    );
    await firstBrowser
      .post('/api/traffic/visit')
      .set('Origin', 'http://localhost:7073')
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/traffic/visit')
      .set('Origin', 'http://localhost:7073')
      .expect(204);

    await expect(visitModel.countDocuments()).resolves.toBe(2);

    const rawCookie = firstVisit.headers['set-cookie']?.[0]
      ?.split(';')[0]
      ?.slice('hmt.vid='.length);
    expect(rawCookie).toBeTruthy();
    const tamperedCookie = `${rawCookie?.slice(0, -1)}${
      rawCookie?.endsWith('A') ? 'B' : 'A'
    }`;
    await request(app.getHttpServer())
      .post('/api/traffic/visit')
      .set('Origin', 'http://localhost:7073')
      .set('Cookie', `hmt.vid=${tamperedCookie}`)
      .expect(204)
      .expect('Set-Cookie', /hmt\.vid=.*HttpOnly/);
    await expect(visitModel.countDocuments()).resolves.toBe(3);
  });

  it('protects results and answer submission before sign-in', async () => {
    await request(app.getHttpServer())
      .get(`/api/questions/${todayKey}/results`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/questions/${todayKey}/answer`)
      .set('Origin', 'http://localhost:7073')
      .send({ value: 10 })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/questions/previous-unanswered?before=2026-07-28')
      .expect(403);
  });

  it('starts Google OAuth with state and an exact callback URL', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/auth/google?returnTo=/q/${todayKey}`)
      .expect(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('test-google-client');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:7000/api/auth/google/callback',
    );
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('returns a failed OAuth callback to the preserved internal question', async () => {
    await agent.get(`/api/auth/google?returnTo=/q/${todayKey}`).expect(302);
    await agent
      .get('/api/auth/google/callback?state=invalid&code=invalid')
      .expect(302)
      .expect('Location', `http://localhost:7073/q/${todayKey}?auth=failed`);
  });

  it('completes the connected test login, answer, result, and logout flow', async () => {
    await agent
      .post('/api/test/auth/Jamie')
      .set('Origin', 'http://localhost:7073')
      .expect(201)
      .expect({ ok: true });
    await agent
      .get('/api/auth/me')
      .expect(200)
      .expect({
        user: {
          firstName: 'Jamie',
          lastInitial: 'T',
          displayName: 'Jamie T.',
        },
      });

    const submitted = await agent
      .post(`/api/questions/${todayKey}/answer`)
      .set('Origin', 'http://localhost:7073')
      .send({ value: 125 })
      .expect(201);
    expect(submitted.body).toEqual(
      expect.objectContaining({
        status: 'unlocked',
        average: 125,
        answerCount: 1,
        userEntry: expect.objectContaining({
          rank: 1,
          value: 125,
          distanceToWinner: 0,
        }),
      }),
    );

    await agent
      .post(`/api/questions/${todayKey}/answer`)
      .set('Origin', 'http://localhost:7073')
      .send({ value: 126 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('ANSWER_ALREADY_SUBMITTED');
      });

    await agent
      .get(`/api/questions/${todayKey}/results`)
      .expect(200)
      .expect((response) => {
        expect(response.body.answerCount).toBe(1);
        expect(response.body.question.key).toBe(todayKey);
      });

    await agent
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:7073')
      .expect(204);
    await agent.get('/api/auth/me').expect(200).expect({ user: null });
  });

  it('keeps a historical shared question sealed until another user answers', async () => {
    await questionModel.create({
      key: 'daily-2026-07-01',
      prompt: 'How many coins could you balance on one fingertip?',
      unit: 'coins',
      minimum: 0,
      maximum: 10_000,
      step: 1,
      precision: 0,
      active: true,
      dayKey: '2026-07-01',
      source: 'gpt',
      requiredAnswerCount: 2,
    });
    await questionModel.create({
      key: 'daily-2026-06-30',
      prompt: 'How many paper cups could fill your kitchen sink?',
      unit: 'cups',
      minimum: 0,
      maximum: 100_000,
      step: 1,
      precision: 0,
      active: true,
      dayKey: '2026-06-30',
      source: 'gpt',
      requiredAnswerCount: 1,
    });
    const first = request.agent(app.getHttpServer());
    const second = request.agent(app.getHttpServer());
    await first
      .post('/api/test/auth/FirstLocker')
      .set('Origin', 'http://localhost:7073')
      .expect(201);
    await second
      .post('/api/test/auth/SecondLocker')
      .set('Origin', 'http://localhost:7073')
      .expect(201);

    await first
      .post('/api/questions/daily-2026-07-01/answer')
      .set('Origin', 'http://localhost:7073')
      .send({ value: 12 })
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            status: 'locked',
            userAnswer: 12,
            answerCount: 1,
            requiredAnswerCount: 2,
            remainingAnswerCount: 1,
          }),
        );
        expect(response.body).not.toHaveProperty('average');
        expect(response.body).not.toHaveProperty('leaders');
      });

    await request(app.getHttpServer())
      .get('/api/questions/daily-2026-07-01')
      .expect(200);
    await first
      .get('/api/questions/previous-unanswered?before=2026-07-01')
      .expect(200)
      .expect((response) => {
        expect(response.body.key).toBe('daily-2026-06-30');
      });
    await second
      .post('/api/questions/daily-2026-07-01/answer')
      .set('Origin', 'http://localhost:7073')
      .send({ value: 20 })
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe('unlocked');
        expect(response.body.answerCount).toBe(2);
      });
    await first
      .get('/api/questions/daily-2026-07-01/results')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('unlocked');
        expect(response.body.average).toBe(16);
      });
  });

  it('exposes the browser login adapter only through the test controller', async () => {
    const browserAgent = request.agent(app.getHttpServer());
    await browserAgent
      .get('/api/test/auth/BrowserQA')
      .expect(302)
      .expect('Location', 'http://localhost:7073');
    await browserAgent
      .get('/api/auth/me')
      .expect(200)
      .expect({
        user: {
          firstName: 'BrowserQA',
          lastInitial: 'T',
          displayName: 'BrowserQA T.',
        },
      });
  });

  it('rejects mutation requests without the exact frontend origin', async () => {
    await request(app.getHttpServer())
      .post('/api/test/auth/NoOrigin')
      .expect(403)
      .expect({
        code: 'INVALID_ORIGIN',
        message: 'This request did not come from the app.',
      });
    await request(app.getHttpServer())
      .post('/api/test/auth/WrongOrigin')
      .set('Origin', 'https://attacker.example')
      .expect(403);
  });
});

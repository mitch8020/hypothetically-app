import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import { MongoMemoryServer } from 'mongodb-memory-server';
import passport from 'passport';
import request, { SuperAgentTest } from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/auth/auth.module';
import { QuestionsModule } from '../src/questions/questions.module';
import { mutationOriginGuard } from '../src/security/mutation-origin.middleware';
import { TestAuthController } from '../src/test-auth/test-auth.controller';
import { UsersModule } from '../src/users/users.module';

describe('How Many, Though? API (e2e)', () => {
  let mongo: MongoMemoryServer;
  let moduleFixture: TestingModule;
  let app: INestApplication<App>;
  let agent: SuperAgentTest;
  let sessionStore: MongoStore;

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
    }).compile();

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
    agent = request.agent(app.getHttpServer());
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await sessionStore.close();
    await mongo.stop();
  });

  it('serves health and a seeded public question', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200).expect({
      status: 'ok',
      service: 'hypothetically-app-backend',
    });

    const response = await request(app.getHttpServer())
      .get('/api/questions/random')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual(
      expect.objectContaining({
        key: expect.any(String),
        prompt: expect.any(String),
        unit: expect.any(String),
      }),
    );
    expect(response.body).not.toHaveProperty('_id');
  });

  it('protects results and answer submission before sign-in', async () => {
    await request(app.getHttpServer())
      .get('/api/questions/doors-opened/results')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/questions/doors-opened/answer')
      .set('Origin', 'http://localhost:7073')
      .send({ value: 10 })
      .expect(403);
  });

  it('starts Google OAuth with state and an exact callback URL', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/google?returnTo=/q/doors-opened')
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
    await agent.get('/api/auth/google?returnTo=/q/doors-opened').expect(302);
    await agent
      .get('/api/auth/google/callback?state=invalid&code=invalid')
      .expect(302)
      .expect('Location', 'http://localhost:7073/q/doors-opened?auth=failed');
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
      .post('/api/questions/doors-opened/answer')
      .set('Origin', 'http://localhost:7073')
      .send({ value: 125 })
      .expect(201);
    expect(submitted.body).toEqual(
      expect.objectContaining({
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
      .post('/api/questions/doors-opened/answer')
      .set('Origin', 'http://localhost:7073')
      .send({ value: 126 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('ANSWER_ALREADY_SUBMITTED');
      });

    await agent
      .get('/api/questions/doors-opened/results')
      .expect(200)
      .expect((response) => {
        expect(response.body.answerCount).toBe(1);
        expect(response.body.question.key).toBe('doors-opened');
      });

    await agent
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:7073')
      .expect(204);
    await agent.get('/api/auth/me').expect(200).expect({ user: null });
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

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import helmet from 'helmet';
import passport from 'passport';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_TTL_SECONDS,
} from '../auth/session.constants';
import { mutationOriginGuard } from '../security/mutation-origin.middleware';
import { configureHttpApplication } from './configure-http-application';

jest.mock('connect-mongo', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock('express-session', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('helmet', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('passport', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    session: jest.fn(),
  },
}));
jest.mock('../security/mutation-origin.middleware', () => ({
  mutationOriginGuard: jest.fn(),
}));

const mongoStoreCreateSpy = jest.spyOn(MongoStore, 'create');
const passportInitializeSpy = jest.spyOn(passport, 'initialize');
const passportSessionSpy = jest.spyOn(passport, 'session');

function applicationDouble() {
  const expressSet = jest.fn();
  const app = {
    enableCors: jest.fn(),
    getHttpAdapter: jest.fn().mockReturnValue({
      getInstance: () => ({ set: expressSet }),
    }),
    setGlobalPrefix: jest.fn(),
    use: jest.fn(),
    useGlobalPipes: jest.fn(),
  };
  return {
    app: app as unknown as INestApplication,
    calls: app,
    expressSet,
  };
}

function configDouble(nodeEnv: 'development' | 'production'): ConfigService {
  const values: Record<string, string> = {
    FRONTEND_URL: 'http://localhost:7073',
    MONGODB_URI: 'mongodb://localhost:27017/hypothetically-test',
    NODE_ENV: nodeEnv,
    SESSION_SECRET: 'test-only-session-secret',
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('configureHttpApplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mongoStoreCreateSpy.mockReturnValue({} as never);
    jest.mocked(session).mockReturnValue(jest.fn() as never);
    jest.mocked(helmet).mockReturnValue(jest.fn() as never);
    passportInitializeSpy.mockReturnValue(jest.fn() as never);
    passportSessionSpy.mockReturnValue(jest.fn() as never);
    jest.mocked(mutationOriginGuard).mockReturnValue(jest.fn() as never);
  });

  it('configures the shared security, session, and request policies', () => {
    const { app, calls, expressSet } = applicationDouble();

    configureHttpApplication(app, configDouble('development'));

    expect(expressSet).not.toHaveBeenCalled();
    expect(calls.enableCors).toHaveBeenCalledWith({
      origin: 'http://localhost:7073',
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
    });
    expect(mongoStoreCreateSpy).toHaveBeenCalledWith({
      mongoUrl: 'mongodb://localhost:27017/hypothetically-test',
      collectionName: 'sessions',
      ttl: SESSION_TTL_SECONDS,
    });
    expect(session).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SESSION_COOKIE_NAME,
        secret: 'test-only-session-secret',
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          maxAge: SESSION_MAX_AGE_MS,
        },
      }),
    );
    expect(calls.use).toHaveBeenCalledTimes(5);
    expect(calls.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(calls.setGlobalPrefix).toHaveBeenCalledWith('api');
  });

  it('trusts one proxy and enables secure cookies in production', () => {
    const { app, expressSet } = applicationDouble();

    configureHttpApplication(app, configDouble('production'));

    expect(expressSet).toHaveBeenCalledWith('trust proxy', 1);
    expect(session).toHaveBeenCalledWith(
      expect.objectContaining({
        cookie: expect.objectContaining({ secure: true }),
      }),
    );
  });
});

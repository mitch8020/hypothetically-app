import type { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { bootstrap } from './main';

jest.mock('./bootstrap/configure-http-application', () => ({
  configureHttpApplication: jest.fn(),
}));

jest.mock('@nestjs/core', () => {
  const actual = jest.requireActual<typeof import('@nestjs/core')>('@nestjs/core');
  return {
    ...actual,
    NestFactory: {
      ...actual.NestFactory,
      create: jest.fn(),
      createApplicationContext: jest.fn(),
    },
  };
});

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function findMongooseFactory(value: unknown):
  | { useFactory: (value: ConfigService) => unknown }
  | undefined {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const found = findMongooseFactory(candidate);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  if (
    'provide' in value &&
    value.provide === 'MongooseModuleOptions' &&
    'useFactory' in value
  ) {
    return value as { useFactory: (value: ConfigService) => unknown };
  }
  for (const key of ['imports', 'providers']) {
    const found = findMongooseFactory(
      (value as Record<string, unknown>)[key],
    );
    if (found) return found;
  }
  return undefined;
}

describe('runtime entrypoints', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ENABLE_TEST_AUTH;
  });

  it('loads the application module with and without the test-only module', async () => {
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'test';
      process.env.ENABLE_TEST_AUTH = 'true';
      const enabled = require('./app.module') as typeof import('./app.module');
      const enabledImports = Reflect.getMetadata(
        'imports',
        enabled.AppModule,
      ) as unknown[];
      expect(enabledImports).toEqual(
        expect.arrayContaining([expect.any(Function)]),
      );

      const factory = findMongooseFactory(enabledImports);
      expect(factory).toBeDefined();
      const dnsConfig = config({
        MONGODB_DNS_SERVERS: '1.1.1.1,8.8.8.8',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
      });
      expect(factory!.useFactory(dnsConfig)).toEqual({
        uri: 'mongodb://127.0.0.1:27017/test',
      });
      expect(dnsConfig.getOrThrow).toHaveBeenCalledWith('MONGODB_URI');
      const noDnsConfig = config({
        MONGODB_URI: 'mongodb://127.0.0.1:27017/no-dns',
      });
      expect(factory!.useFactory(noDnsConfig)).toEqual({
        uri: 'mongodb://127.0.0.1:27017/no-dns',
      });
    });
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_TEST_AUTH;
    jest.isolateModules(() => {
      const disabled = require('./app.module') as typeof import('./app.module');
      expect(Reflect.getMetadata('imports', disabled.AppModule)).toBeDefined();
    });
    process.env.NODE_ENV = 'test';
  });

  it('covers the false branch of TypeScript decorator metadata helpers', () => {
    const reflect = Reflect as unknown as { metadata?: unknown };
    const previousMetadata = reflect.metadata;
    reflect.metadata = undefined;
    try {
      jest.isolateModules(() => {
        require('./app.module');
      });
      jest.isolateModules(() => {
        jest.doMock('./app.service', () => ({ AppService: undefined }));
        require('./app.controller');
      });
      jest.isolateModules(() => {
        const configModule = jest.requireActual<typeof import('@nestjs/config')>(
          '@nestjs/config',
        );
        jest.doMock('@nestjs/config', () => ({
          ...configModule,
          ConfigService: undefined,
        }));
        jest.doMock('./users/users.service', () => ({ UsersService: undefined }));
        jest.doMock('./auth/auth-session.service', () => ({
          AuthSessionService: undefined,
        }));
        jest.doMock('./questions/questions.service', () => ({
          QuestionsService: undefined,
        }));
        jest.doMock('./questions/traffic.service', () => ({
          TrafficService: undefined,
        }));
        require('./auth/auth.controller');
        require('./auth/google-callback-exception.filter');
        require('./auth/google.strategy');
        require('./auth/session.serializer');
        require('./questions/question-generation.service');
        require('./questions/questions.controller');
        require('./questions/traffic.controller');
        require('./questions/traffic.service');
        require('./test-auth/test-auth.controller');
        require('./users/users.service');
      });
    } finally {
      reflect.metadata = previousMetadata;
    }
  });

  it('bootstraps on the configured and fallback ports', async () => {
    const app = {
      get: jest
        .fn()
        .mockReturnValueOnce(config({ PORT: 7010 }))
        .mockReturnValueOnce(config({ PORT: undefined })),
      listen: jest.fn().mockResolvedValue(undefined),
    } as never;
    (NestFactory.create as jest.Mock)
      .mockResolvedValueOnce(app)
      .mockResolvedValueOnce(app);

    await bootstrap();
    await bootstrap();

    expect(NestFactory.create).toHaveBeenCalledTimes(2);
    expect(app.listen).toHaveBeenNthCalledWith(1, 7010, '0.0.0.0');
    expect(app.listen).toHaveBeenNthCalledWith(2, 7000, '0.0.0.0');
  });

  it('executes the production main entrypoint guard', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const app = {
      get: jest.fn().mockReturnValue(config({ PORT: 7011 })),
      listen: jest.fn().mockResolvedValue(undefined),
    } as never;
    (NestFactory.create as jest.Mock).mockResolvedValue(app);

    jest.isolateModules(() => {
      require('./main');
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(app.listen).toHaveBeenCalledWith(7011, '0.0.0.0');
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('runs scheduler success and failure paths while always closing the context', async () => {
    const { generateDailyQuestion, runSchedulerCommand } = require(
      './generate-daily-question',
    ) as typeof import('./generate-daily-question');
    const close = jest.fn().mockResolvedValue(undefined);
    const generateFromScheduler = jest
      .fn()
      .mockResolvedValueOnce({ status: 'skipped', dayKey: '2026-07-31' })
      .mockResolvedValueOnce({ status: 'ready', question: {} });
    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue({
      get: jest.fn().mockReturnValue({ generateFromScheduler }),
      close,
    });
    const dependencies = () =>
      Promise.resolve({ AppModule: class AppModule {}, QuestionsService: class QuestionsService {} });
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await generateDailyQuestion(dependencies, ['node', 'scheduler']);
    await generateDailyQuestion(dependencies, ['node', 'scheduler', '--force']);
    expect(log).toHaveBeenNthCalledWith(1, 'daily-question:skipped:2026-07-31');
    expect(log).toHaveBeenNthCalledWith(2, 'daily-question:ready:legacy');
    expect(generateFromScheduler).toHaveBeenNthCalledWith(
      1,
      expect.any(Date),
      false,
    );
    expect(generateFromScheduler).toHaveBeenNthCalledWith(
      2,
      expect.any(Date),
      true,
    );
    expect(close).toHaveBeenCalledTimes(2);

    const failure = new Error('scheduler down');
    const failingApplication = {
      get: jest.fn().mockReturnValue({
        generateFromScheduler: jest.fn().mockRejectedValue(failure),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValueOnce(
      failingApplication,
    );
    await expect(runSchedulerCommand(dependencies, ['node', 'scheduler'])).resolves.toBeUndefined();
    expect(failingApplication.close).toHaveBeenCalled();
    process.exitCode = 0;
    log.mockRestore();
  });

  it('formats non-Error scheduler failures for the command wrapper', async () => {
    const { runSchedulerCommand } = require(
      './generate-daily-question',
    ) as typeof import('./generate-daily-question');
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      runSchedulerCommand(() => Promise.reject('broken'), ['node', 'scheduler']),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('daily-question:failed:Unknown Scheduler failure');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    error.mockRestore();
  });

  it('executes the production scheduler entrypoint guard', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    jest.isolateModules(() => {
      require('./generate-daily-question');
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('daily-question:failed:'),
    );
    error.mockRestore();
    process.exitCode = 0;
    process.env.NODE_ENV = previousNodeEnv;
  });
});

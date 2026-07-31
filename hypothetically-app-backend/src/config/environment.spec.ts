import { validateEnvironment } from './environment';

const validEnvironment = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/how-many-though',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:7000/api/auth/google/callback',
  FRONTEND_URL: 'http://localhost:7073',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-characters',
  OPENAI_API_KEY: 'test-openai-key',
};

describe('environment validation', () => {
  it('normalizes the port and optional MongoDB DNS servers', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        PORT: '7001',
        MONGODB_DNS_SERVERS: ' 1.1.1.1, 8.8.8.8 ',
      }),
    ).toEqual(
      expect.objectContaining({
        PORT: 7001,
        MONGODB_DNS_SERVERS: '1.1.1.1,8.8.8.8',
        APP_TIME_ZONE: 'America/Chicago',
      }),
    );
  });

  it('uses local defaults and test-only credentials when optional values are absent', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        MONGODB_URI: validEnvironment.MONGODB_URI,
        SESSION_SECRET: validEnvironment.SESSION_SECRET,
      }),
    ).toEqual(
      expect.objectContaining({
        NODE_ENV: 'test',
        PORT: 7000,
        FRONTEND_URL: 'http://localhost:7073',
        GOOGLE_CALLBACK_URL:
          'http://localhost:7000/api/auth/google/callback',
        GOOGLE_CLIENT_ID: 'test-google-client',
        GOOGLE_CLIENT_SECRET: 'test-google-secret',
        OPENAI_API_KEY: 'test-openai-key',
      }),
    );
    expect(
      validateEnvironment({
        ...validEnvironment,
        MONGODB_DNS_SERVERS: '   ',
      }),
    ).toHaveProperty('MONGODB_DNS_SERVERS', '   ');
    expect(
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: undefined,
      }),
    ).toEqual(expect.objectContaining({ NODE_ENV: 'development' }));
  });

  it('rejects weak secrets, malformed URLs, and invalid DNS servers', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        SESSION_SECRET: 'too-short',
      }),
    ).toThrow('SESSION_SECRET');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        FRONTEND_URL: 'not-a-url',
      }),
    ).toThrow('FRONTEND_URL');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        MONGODB_DNS_SERVERS: 'not-an-ip',
      }),
    ).toThrow('MONGODB_DNS_SERVERS');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        APP_TIME_ZONE: 'Central-ish',
      }),
    ).toThrow('APP_TIME_ZONE');
    expect(() =>
      validateEnvironment({ ...validEnvironment, PORT: 'not-a-number' }),
    ).toThrow('PORT');
    expect(() =>
      validateEnvironment({ ...validEnvironment, PORT: '0' }),
    ).toThrow('PORT');
  });
});

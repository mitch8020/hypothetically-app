import { isIP } from 'node:net';

const LOCAL_FRONTEND_URL = 'http://localhost:7073';
const LOCAL_GOOGLE_CALLBACK_URL =
  'http://localhost:7000/api/auth/google/callback';

type Environment = Record<string, unknown>;

function requiredString(
  environment: Environment,
  key: string,
  minimumLength = 1,
): string {
  const value = environment[key];
  if (typeof value !== 'string' || value.trim().length < minimumLength) {
    throw new Error(
      `${key} is required and must contain at least ${minimumLength} characters.`,
    );
  }
  return value.trim();
}

function validUrl(value: string, key: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${key} must be a valid absolute URL.`);
  }
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalDnsServers(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const servers = value
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (servers.length === 0 || servers.some((server) => isIP(server) === 0)) {
    throw new Error(
      'MONGODB_DNS_SERVERS must be a comma-separated list of IP addresses.',
    );
  }
  return servers.join(',');
}

export function validateEnvironment(environment: Environment): Environment {
  const nodeEnvironment =
    typeof environment.NODE_ENV === 'string'
      ? environment.NODE_ENV
      : 'development';
  const isTest = nodeEnvironment === 'test';
  const port = Number(environment.PORT ?? 7000);
  const mongodbDnsServers = optionalDnsServers(environment.MONGODB_DNS_SERVERS);

  if (!Number.isInteger(port) || port < 1) {
    throw new Error('PORT must be a positive integer.');
  }

  const validated: Environment = {
    ...environment,
    NODE_ENV: nodeEnvironment,
    PORT: port,
    MONGODB_URI: requiredString(environment, 'MONGODB_URI'),
    FRONTEND_URL: validUrl(
      optionalString(environment.FRONTEND_URL, LOCAL_FRONTEND_URL),
      'FRONTEND_URL',
    ),
    GOOGLE_CALLBACK_URL: validUrl(
      optionalString(
        environment.GOOGLE_CALLBACK_URL,
        LOCAL_GOOGLE_CALLBACK_URL,
      ),
      'GOOGLE_CALLBACK_URL',
    ),
    SESSION_SECRET: requiredString(environment, 'SESSION_SECRET', 32),
    ...(mongodbDnsServers ? { MONGODB_DNS_SERVERS: mongodbDnsServers } : {}),
  };

  if (!isTest) {
    validated.GOOGLE_CLIENT_ID = requiredString(
      environment,
      'GOOGLE_CLIENT_ID',
    );
    validated.GOOGLE_CLIENT_SECRET = requiredString(
      environment,
      'GOOGLE_CLIENT_SECRET',
    );
  } else {
    validated.GOOGLE_CLIENT_ID = optionalString(
      environment.GOOGLE_CLIENT_ID,
      'test-google-client',
    );
    validated.GOOGLE_CLIENT_SECRET = optionalString(
      environment.GOOGLE_CLIENT_SECRET,
      'test-google-secret',
    );
  }

  return validated;
}

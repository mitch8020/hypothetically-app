import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
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

interface ProxyAwareExpressApplication {
  set(name: string, value: number): void;
}

export function configureHttpApplication(
  app: INestApplication,
  config: ConfigService,
): void {
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const frontendUrl = config.getOrThrow<string>('FRONTEND_URL');

  if (isProduction) {
    const expressApplication = app
      .getHttpAdapter()
      .getInstance() as ProxyAwareExpressApplication;
    expressApplication.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  app.use(
    session({
      name: SESSION_COOKIE_NAME,
      secret: config.getOrThrow<string>('SESSION_SECRET'),
      store: MongoStore.create({
        mongoUrl: config.getOrThrow<string>('MONGODB_URI'),
        collectionName: 'sessions',
        ttl: SESSION_TTL_SECONDS,
      }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: SESSION_MAX_AGE_MS,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(mutationOriginGuard(frontendUrl));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api');
}

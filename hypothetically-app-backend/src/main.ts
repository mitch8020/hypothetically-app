import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import helmet from 'helmet';
import passport from 'passport';
import { AppModule } from './app.module';
import { mutationOriginGuard } from './security/mutation-origin.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const frontendUrl = config.getOrThrow<string>('FRONTEND_URL');

  if (isProduction) {
    const expressApplication = app.getHttpAdapter().getInstance() as {
      set(name: string, value: number): void;
    };
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
      name: 'hmt.sid',
      secret: config.getOrThrow<string>('SESSION_SECRET'),
      store: MongoStore.create({
        mongoUrl: config.getOrThrow<string>('MONGODB_URI'),
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 30,
      }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 24 * 30,
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

  await app.listen(config.get<number>('PORT') ?? 7000, '0.0.0.0');
}

void bootstrap();

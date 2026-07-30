import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApplication } from './bootstrap/configure-http-application';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  configureHttpApplication(app, config);

  await app.listen(config.get<number>('PORT') ?? 7000, '0.0.0.0');
}

void bootstrap();

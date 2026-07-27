import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { setServers } from 'node:dns';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/environment';
import { QuestionsModule } from './questions/questions.module';
import { TestAuthModule } from './test-auth/test-auth.module';
import { UsersModule } from './users/users.module';

const testOnlyImports =
  process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_AUTH === 'true'
    ? [TestAuthModule]
    : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dnsServers = config.get<string>('MONGODB_DNS_SERVERS');
        if (dnsServers) {
          setServers(dnsServers.split(','));
        }
        return {
          uri: config.getOrThrow<string>('MONGODB_URI'),
        };
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*path}'],
    }),
    UsersModule,
    AuthModule,
    QuestionsModule,
    ...testOnlyImports,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthSessionService } from './auth-session.service';
import { GoogleCallbackExceptionFilter } from './google-callback-exception.filter';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleStrategy } from './google.strategy';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionSerializer } from './session.serializer';

@Module({
  imports: [PassportModule.register({ session: true }), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthSessionService,
    GoogleAuthGuard,
    GoogleCallbackExceptionFilter,
    GoogleStrategy,
    SessionAuthGuard,
    SessionSerializer,
  ],
  exports: [SessionAuthGuard],
})
export class AuthModule {}

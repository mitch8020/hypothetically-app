import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { TestAuthController } from './test-auth.controller';

@Module({
  imports: [PassportModule.register({ session: true }), UsersModule],
  controllers: [TestAuthController],
})
export class TestAuthModule {}

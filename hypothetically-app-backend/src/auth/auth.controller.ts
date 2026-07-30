import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { UsersService } from '../users/users.service';
import { AuthSessionService } from './auth-session.service';
import { GoogleCallbackExceptionFilter } from './google-callback-exception.filter';
import { GoogleAuthGuard } from './google-auth.guard';
import { SESSION_COOKIE_NAME } from './session.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly authSession: AuthSessionService,
  ) {}

  @Get('me')
  me(@Req() request: Request): {
    user: ReturnType<UsersService['toPublicUser']> | null;
  } {
    return {
      user: request.user ? this.usersService.toPublicUser(request.user) : null,
    };
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  google(): void {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @UseFilters(GoogleCallbackExceptionFilter)
  async googleCallback(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const user = request.user;
    const returnTo = request.session.returnTo ?? '/';
    if (!user) {
      response.redirect(
        `${this.config.getOrThrow<string>('FRONTEND_URL')}/?auth=failed`,
      );
      return;
    }

    await this.authSession.signIn(request, user);

    response.redirect(
      new URL(
        returnTo,
        this.config.getOrThrow<string>('FRONTEND_URL'),
      ).toString(),
    );
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.authSession.signOut(request);
    response.clearCookie(SESSION_COOKIE_NAME);
    response.status(204).send();
  }
}

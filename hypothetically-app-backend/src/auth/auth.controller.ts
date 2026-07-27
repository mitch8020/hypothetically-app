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
import { GoogleCallbackExceptionFilter } from './google-callback-exception.filter';
import { GoogleAuthGuard } from './google-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
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

    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((regenerateError) => {
        if (regenerateError) {
          reject(this.asError(regenerateError, 'Could not renew the session.'));
          return;
        }
        request.login(user, (loginError) => {
          if (loginError) {
            reject(this.asError(loginError, 'Could not complete sign-in.'));
            return;
          }
          resolve();
        });
      });
    });

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
    await new Promise<void>((resolve, reject) => {
      request.logout((logoutError) => {
        if (logoutError) {
          reject(this.asError(logoutError, 'Could not sign out.'));
          return;
        }
        request.session.destroy((destroyError) => {
          if (destroyError) {
            reject(this.asError(destroyError, 'Could not clear the session.'));
            return;
          }
          resolve();
        });
      });
    });
    response.clearCookie('hmt.sid');
    response.status(204).send();
  }

  private asError(value: unknown, fallbackMessage: string): Error {
    return value instanceof Error ? value : new Error(fallbackMessage);
  }
}

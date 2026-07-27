import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { UsersService } from '../users/users.service';

@Controller('test/auth')
export class TestAuthController {
  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Post(':subject')
  async login(
    @Param('subject') subject: string,
    @Req() request: Request,
  ): Promise<{ ok: true }> {
    await this.loginUser(subject, request);
    return { ok: true };
  }

  @Get(':subject')
  async browserLogin(
    @Param('subject') subject: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.loginUser(subject, request);
    response.redirect(this.config.getOrThrow<string>('FRONTEND_URL'));
  }

  private async loginUser(subject: string, request: Request): Promise<void> {
    const firstName =
      subject.replace(/[^a-z0-9]/gi, '').slice(0, 30) || 'Tester';
    const user = await this.usersService.upsertGoogleProfile({
      googleSubject: `test:${subject}`,
      firstName,
      lastInitial: 'T',
    });
    await new Promise<void>((resolve, reject) => {
      request.login(user, (error) => {
        if (error) {
          reject(
            error instanceof Error
              ? error
              : new Error('Could not create the test session.'),
          );
          return;
        }
        resolve();
      });
    });
  }
}

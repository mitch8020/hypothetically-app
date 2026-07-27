import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

const ALLOWED_RETURN_TO = /^\/q\/[a-z0-9-]+(?:\/results)?$/;

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext): {
    scope: string[];
    state: boolean;
  } {
    const request = context.switchToHttp().getRequest<Request>();
    const requestedReturnTo =
      typeof request.query.returnTo === 'string' ? request.query.returnTo : '';
    request.session.returnTo = ALLOWED_RETURN_TO.test(requestedReturnTo)
      ? requestedReturnTo
      : '/';

    return {
      scope: ['openid', 'profile'],
      state: true,
    };
  }
}

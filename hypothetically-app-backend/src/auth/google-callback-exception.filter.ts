import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

@Catch()
@Injectable()
export class GoogleCallbackExceptionFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService) {}

  catch(_exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const returnTo = request.session.returnTo ?? '/';
    const failureUrl = new URL(
      returnTo,
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    failureUrl.searchParams.set('auth', 'failed');
    response.redirect(failureUrl.toString());
  }
}

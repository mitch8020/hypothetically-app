import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

type SessionOperation = (complete: (error?: unknown) => void) => void;

@Injectable()
export class AuthSessionService {
  async signIn(request: Request, user: Express.User): Promise<void> {
    await this.runSessionOperation(
      (complete) => request.session.regenerate(complete),
      'Could not renew the session.',
    );
    await this.runSessionOperation(
      (complete) => request.login(user, complete),
      'Could not complete sign-in.',
    );
  }

  async signOut(request: Request): Promise<void> {
    await this.runSessionOperation(
      (complete) => request.logout(complete),
      'Could not sign out.',
    );
    await this.runSessionOperation(
      (complete) => request.session.destroy(complete),
      'Could not clear the session.',
    );
  }

  private runSessionOperation(
    operation: SessionOperation,
    fallbackMessage: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      operation((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(fallbackMessage));
          return;
        }
        resolve();
      });
    });
  }
}

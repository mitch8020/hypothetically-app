import type { Request } from 'express';
import { AuthSessionService } from './auth-session.service';

function requestWithSessionOperations(operations?: {
  regenerateError?: unknown;
  loginError?: unknown;
  logoutError?: unknown;
  destroyError?: unknown;
  order?: string[];
}): Request {
  const order = operations?.order ?? [];
  return {
    session: {
      regenerate: (complete: (error?: unknown) => void) => {
        order.push('regenerate');
        complete(operations?.regenerateError);
      },
      destroy: (complete: (error?: unknown) => void) => {
        order.push('destroy');
        complete(operations?.destroyError);
      },
    },
    login: (_user: Express.User, complete: (error?: unknown) => void) => {
      order.push('login');
      complete(operations?.loginError);
    },
    logout: (complete: (error?: unknown) => void) => {
      order.push('logout');
      complete(operations?.logoutError);
    },
  } as unknown as Request;
}

describe('AuthSessionService', () => {
  const service = new AuthSessionService();
  const user = {} as Express.User;

  it('renews the session before logging the user in', async () => {
    const order: string[] = [];

    await service.signIn(requestWithSessionOperations({ order }), user);

    expect(order).toEqual(['regenerate', 'login']);
  });

  it('does not log the user in when session renewal fails', async () => {
    const order: string[] = [];
    const error = new Error('renewal failed');

    await expect(
      service.signIn(
        requestWithSessionOperations({ regenerateError: error, order }),
        user,
      ),
    ).rejects.toBe(error);
    expect(order).toEqual(['regenerate']);
  });

  it('normalizes non-Error login failures', async () => {
    await expect(
      service.signIn(
        requestWithSessionOperations({ loginError: 'login failed' }),
        user,
      ),
    ).rejects.toThrow('Could not complete sign-in.');
  });

  it('logs the user out before destroying the session', async () => {
    const order: string[] = [];

    await service.signOut(requestWithSessionOperations({ order }));

    expect(order).toEqual(['logout', 'destroy']);
  });

  it('does not destroy the session when logout fails', async () => {
    const order: string[] = [];
    const error = new Error('logout failed');

    await expect(
      service.signOut(
        requestWithSessionOperations({ logoutError: error, order }),
      ),
    ).rejects.toBe(error);
    expect(order).toEqual(['logout']);
  });

  it('normalizes non-Error session destruction failures', async () => {
    await expect(
      service.signOut(
        requestWithSessionOperations({ destroyError: 'destroy failed' }),
      ),
    ).rejects.toThrow('Could not clear the session.');
  });
});

import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuthSessionService } from './auth/auth-session.service';
import { QuestionsController } from './questions/questions.controller';
import { TrafficController } from './questions/traffic.controller';
import { TestAuthController } from './test-auth/test-auth.controller';
import { UsersService } from './users/users.service';

function request(overrides: Partial<Request> = {}): Request {
  return {
    user: { _id: new Types.ObjectId() } as Express.User,
    session: {},
    login: (_user: Express.User, done: (error?: unknown) => void) => done(),
    ...overrides,
  } as unknown as Request;
}

describe('controller coverage', () => {
  it('handles question controller response boundaries and delegates all routes', async () => {
    const question = { key: 'daily-test', prompt: 'How many?', unit: 'things' };
    const response = {
      setHeader: jest.fn(),
      status: jest.fn(),
    } as unknown as Response;
    const service = {
      findRandomQuestion: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(question),
      findArchive: jest.fn().mockResolvedValue({ questions: [], total: 0 }),
      findTodayQuestion: jest.fn().mockResolvedValue(question),
      findPreviousUnansweredQuestion: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(question),
      findPublicQuestion: jest.fn().mockResolvedValue(question),
      submitAnswer: jest.fn().mockResolvedValue({ status: 'locked' }),
      getResult: jest.fn().mockResolvedValue({ status: 'unlocked' }),
    } as never;
    const controller = new QuestionsController(service);
    const loggedIn = request();

    await expect(controller.random(loggedIn, response)).resolves.toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(204);
    await expect(controller.random(loggedIn, response)).resolves.toEqual(question);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    await expect(controller.today(response)).resolves.toEqual(question);
    await expect(
      controller.archive(loggedIn, response, 'answered', 'food'),
    ).resolves.toEqual({ questions: [], total: 0 });
    expect(service.findArchive).toHaveBeenCalledWith(
      loggedIn.user,
      'answered',
      'food',
    );
    await expect(controller.archive(loggedIn, response)).resolves.toEqual({
      questions: [],
      total: 0,
    });

    await expect(
      controller.previousUnanswered(loggedIn, response, '2026-07-27'),
    ).resolves.toBeUndefined();
    await expect(
      controller.previousUnanswered(loggedIn, response),
    ).resolves.toEqual(question);
    expect(service.findPreviousUnansweredQuestion).toHaveBeenCalledWith(
      loggedIn.user,
      undefined,
    );

    await expect(controller.question('daily-test')).resolves.toEqual(question);
    await expect(
      controller.answer('daily-test', loggedIn, { value: 12, timeZone: 'UTC' }),
    ).resolves.toEqual({ status: 'locked' });
    expect(service.submitAnswer).toHaveBeenCalledWith(
      'daily-test',
      loggedIn.user,
      12,
      'UTC',
    );
    await expect(
      controller.results('daily-test', loggedIn, 'America/Chicago'),
    ).resolves.toEqual({ status: 'unlocked' });
  });

  it('delegates traffic visits with the request and response', async () => {
    const recordVisit = jest.fn().mockResolvedValue(undefined);
    const controller = new TrafficController({ recordVisit } as never);
    const req = request();
    const response = {} as Response;

    await expect(controller.visit(req, response)).resolves.toBeUndefined();
    expect(recordVisit).toHaveBeenCalledWith(req, response);
  });

  it('supports test authentication login, browser redirects, and failures', async () => {
    const user = { _id: new Types.ObjectId(), firstName: 'Tester' } as Express.User;
    const upsertGoogleProfile = jest.fn().mockResolvedValue(user);
    const users = { upsertGoogleProfile } as unknown as UsersService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('http://localhost:7073'),
    } as unknown as ConfigService;
    const controller = new TestAuthController(users, config);

    const loginRequest = request();
    await expect(controller.login('A user!', loginRequest)).resolves.toEqual({
      ok: true,
    });
    expect(upsertGoogleProfile).toHaveBeenCalledWith({
      googleSubject: 'test:A user!',
      firstName: 'Auser',
      lastInitial: 'T',
    });

    const redirect = jest.fn();
    await controller.browserLogin(
      '!!!',
      request(),
      { redirect } as unknown as Response,
    );
    expect(upsertGoogleProfile).toHaveBeenLastCalledWith({
      googleSubject: 'test:!!!',
      firstName: 'Tester',
      lastInitial: 'T',
    });
    expect(redirect).toHaveBeenCalledWith('http://localhost:7073');

    const errorLogin = request({
      login: (_user, done) => done(new Error('login failed')),
    });
    await expect(controller.login('error', errorLogin)).rejects.toThrow(
      'login failed',
    );
    const unknownErrorLogin = request({
      login: (_user, done) => done('not an Error'),
    });
    await expect(controller.login('error', unknownErrorLogin)).rejects.toThrow(
      'Could not create the test session.',
    );
  });

  it('covers a missing test subject fallback without changing its identity key', async () => {
    const upsertGoogleProfile = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
    });
    const controller = new TestAuthController(
      { upsertGoogleProfile } as unknown as UsersService,
      { getOrThrow: jest.fn() } as unknown as ConfigService,
    );
    await expect(controller.login('', request())).resolves.toEqual({ ok: true });
    expect(upsertGoogleProfile).toHaveBeenCalledWith(
      expect.objectContaining({ googleSubject: 'test:', firstName: 'Tester' }),
    );
  });
});

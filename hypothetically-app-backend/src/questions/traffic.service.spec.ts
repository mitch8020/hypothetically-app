import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Model } from 'mongoose';
import { DailyVisit } from './schemas/daily-visit.schema';
import { TrafficService } from './traffic.service';

describe('TrafficService', () => {
  const exec = jest.fn().mockResolvedValue(undefined);
  const updateOne = jest.fn().mockReturnValue({ exec });
  const cookie = jest.fn();
  const configValues: Record<string, string> = {
    SESSION_SECRET: 'test-session-secret-at-least-32-characters',
    APP_TIME_ZONE: 'America/Chicago',
    NODE_ENV: 'test',
  };
  let service: TrafficService;

  beforeEach(() => {
    exec.mockClear();
    updateOne.mockClear();
    cookie.mockClear();
    service = new TrafficService(
      { updateOne } as unknown as Model<DailyVisit>,
      {
        getOrThrow: jest.fn((key: string) => configValues[key]),
        get: jest.fn((key: string) => configValues[key]),
      } as unknown as ConfigService,
    );
  });

  function requestWithCookie(value?: string): Request {
    return {
      headers: value ? { cookie: `hmt.vid=${value}` } : {},
    } as Request;
  }

  const response = { cookie } as unknown as Response;
  const now = new Date('2026-07-28T16:00:00.000Z');

  it('reuses a valid signed browser cookie without storing its raw value', async () => {
    await service.recordVisit(requestWithCookie(), response, now);
    const signedCookie = cookie.mock.calls[0][1] as string;
    const firstFilter = updateOne.mock.calls[0][0] as {
      dayKey: string;
      visitorHash: string;
    };

    cookie.mockClear();
    await service.recordVisit(
      requestWithCookie(encodeURIComponent(signedCookie)),
      response,
      now,
    );
    const secondFilter = updateOne.mock.calls[1][0] as {
      dayKey: string;
      visitorHash: string;
    };

    expect(cookie).not.toHaveBeenCalled();
    expect(secondFilter).toEqual(firstFilter);
    expect(firstFilter.dayKey).toBe('2026-07-28');
    expect(JSON.stringify(updateOne.mock.calls)).not.toContain(
      signedCookie.split('.')[0],
    );
  });

  it('rejects a tampered cookie and rotates to a new anonymous identity', async () => {
    await service.recordVisit(requestWithCookie(), response, now);
    const signedCookie = cookie.mock.calls[0][1] as string;
    const tampered = `${signedCookie.slice(0, -1)}${
      signedCookie.endsWith('A') ? 'B' : 'A'
    }`;
    const originalHash = (updateOne.mock.calls[0][0] as { visitorHash: string })
      .visitorHash;

    cookie.mockClear();
    await service.recordVisit(requestWithCookie(tampered), response, now);
    const rotatedHash = (updateOne.mock.calls[1][0] as { visitorHash: string })
      .visitorHash;

    expect(cookie).toHaveBeenCalledWith(
      'hmt.vid',
      expect.not.stringMatching(new RegExp(`^${signedCookie}$`)),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(rotatedHash).not.toBe(originalHash);
  });
});

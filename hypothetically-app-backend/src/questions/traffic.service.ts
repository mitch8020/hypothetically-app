import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import { DEFAULT_QUESTION_TIME_ZONE, questionDayKey } from './question-day';
import { DailyVisit } from './schemas/daily-visit.schema';
import {
  hashVisitorId,
  readCookie,
  signVisitorId,
  verifyVisitorCookie,
  VISITOR_COOKIE_MAX_AGE_MS,
  VISITOR_COOKIE_NAME,
} from './visitor-identity';

const VISIT_RETENTION_MS = 1000 * 60 * 60 * 24 * 35;

@Injectable()
export class TrafficService {
  private readonly secret: string;
  private readonly timeZone: string;
  private readonly isProduction: boolean;

  constructor(
    @InjectModel(DailyVisit.name)
    private readonly visitModel: Model<DailyVisit>,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('SESSION_SECRET');
    this.timeZone =
      config.get<string>('APP_TIME_ZONE') ?? DEFAULT_QUESTION_TIME_ZONE;
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  async recordVisit(
    request: Request,
    response: Response,
    now = new Date(),
  ): Promise<void> {
    const existing = readCookie(request.headers.cookie, VISITOR_COOKIE_NAME);
    const visitorId =
      verifyVisitorCookie(existing, this.secret) ?? randomUUID();
    if (!existing || visitorId !== existing.split('.')[0]) {
      response.cookie(
        VISITOR_COOKIE_NAME,
        signVisitorId(visitorId, this.secret),
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: this.isProduction,
          maxAge: VISITOR_COOKIE_MAX_AGE_MS,
          path: '/',
        },
      );
    }

    const visitorHash = hashVisitorId(visitorId, this.secret);
    const expiresAt = new Date(now.getTime() + VISIT_RETENTION_MS);
    await this.visitModel
      .updateOne(
        { dayKey: questionDayKey(now, this.timeZone), visitorHash },
        { $setOnInsert: { expiresAt } },
        { upsert: true },
      )
      .exec();
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Request, Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Model } from 'mongoose';
import { DEFAULT_QUESTION_TIME_ZONE, questionDayKey } from './question-day';
import { DailyVisit } from './schemas/daily-visit.schema';

const VISITOR_COOKIE = 'hmt.vid';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 400;
const VISIT_RETENTION_MS = 1000 * 60 * 60 * 24 * 35;

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  for (const segment of raw.split(';')) {
    const separator = segment.indexOf('=');
    if (separator === -1) continue;
    if (segment.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

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
    const existing = cookieValue(request, VISITOR_COOKIE);
    const visitorId = this.verify(existing) ?? randomUUID();
    if (!existing || visitorId !== existing.split('.')[0]) {
      response.cookie(VISITOR_COOKIE, this.sign(visitorId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.isProduction,
        maxAge: COOKIE_MAX_AGE_MS,
        path: '/',
      });
    }

    const visitorHash = createHmac('sha256', this.secret)
      .update(`daily-visit:${visitorId}`)
      .digest('hex');
    const expiresAt = new Date(now.getTime() + VISIT_RETENTION_MS);
    await this.visitModel
      .updateOne(
        { dayKey: questionDayKey(now, this.timeZone), visitorHash },
        { $setOnInsert: { expiresAt } },
        { upsert: true },
      )
      .exec();
  }

  private sign(visitorId: string): string {
    const signature = createHmac('sha256', this.secret)
      .update(`visitor-cookie:${visitorId}`)
      .digest('base64url');
    return `${visitorId}.${signature}`;
  }

  private verify(value?: string): string | undefined {
    if (!value) return undefined;
    const [visitorId, signature, extra] = value.split('.');
    if (!visitorId || !signature || extra) return undefined;
    const expected = createHmac('sha256', this.secret)
      .update(`visitor-cookie:${visitorId}`)
      .digest('base64url');
    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return undefined;
    }
    return visitorId;
  }
}

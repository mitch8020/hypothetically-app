import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { QUESTION_CATALOG } from './question.catalog';
import { validateGeneratedQuestion } from './question-candidate';
import {
  DEFAULT_QUESTION_TIME_ZONE,
  isQuestionGenerationHour,
  previousQuestionDay,
  questionDayKey,
  requiredAnswerCount,
} from './question-day';
import {
  GeneratedQuestion,
  QUESTION_PROMPT_VERSION,
  QuestionGenerationService,
} from './question-generation.service';
import {
  LeaderboardEntry,
  PublicQuestion,
  QuestionResult,
  UnlockedQuestionResult,
} from './question.types';
import { Answer } from './schemas/answer.schema';
import { DailyVisit } from './schemas/daily-visit.schema';
import { Question, QuestionDocument } from './schemas/question.schema';
import { QuestionGeneration } from './schemas/question-generation.schema';

interface PopulatedAnswer {
  user: User & { _id: Types.ObjectId };
  value: number;
  createdAt: Date;
}

interface RankedAnswer extends LeaderboardEntry {
  userId: string;
  createdAt: Date;
}

const GENERATION_LEASE_MS = 90_000;
const GENERATION_RETRY_MS = 60_000;
const RECENT_PROMPT_LIMIT = 90;
@Injectable()
export class QuestionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuestionsService.name);
  private readonly timeZone: string;
  private readonly isTest: boolean;

  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<Question>,
    @InjectModel(Answer.name)
    private readonly answerModel: Model<Answer>,
    @InjectModel(DailyVisit.name)
    private readonly visitModel: Model<DailyVisit>,
    @InjectModel(QuestionGeneration.name)
    private readonly generationModel: Model<QuestionGeneration>,
    private readonly generator: QuestionGenerationService,
    config: ConfigService,
  ) {
    this.timeZone =
      config.get<string>('APP_TIME_ZONE') ?? DEFAULT_QUESTION_TIME_ZONE;
    this.isTest = config.get<string>('NODE_ENV') === 'test';
  }

  onApplicationBootstrap(): void {
    if (this.isTest || process.env.DAILY_QUESTION_SCHEDULER_RUN === 'true') {
      return;
    }
    void this.ensureTodayQuestion().catch((error: unknown) => {
      this.logger.warn(
        `Daily question bootstrap is waiting for a retry: ${this.errorCode(error)}`,
      );
    });
  }

  async generateFromScheduler(
    now = new Date(),
    force = false,
  ): Promise<
    | { status: 'ready'; question: PublicQuestion }
    | { status: 'skipped'; dayKey: string }
  > {
    const dayKey = questionDayKey(now, this.timeZone);
    if (!force && !isQuestionGenerationHour(now, this.timeZone)) {
      this.logger.log(
        `Skipping the ${dayKey} Scheduler run outside the local midnight hour.`,
      );
      return { status: 'skipped', dayKey };
    }
    const question = this.toPublicQuestion(await this.ensureTodayQuestion(now));
    this.logger.log(`Daily question is ready for ${dayKey}.`);
    return { status: 'ready', question };
  }

  toPublicQuestion(question: Question): PublicQuestion {
    return {
      key: question.key,
      prompt: question.prompt,
      unit: question.unit,
      minimum: question.minimum,
      maximum: question.maximum,
      step: question.step,
      precision: question.precision,
      ...(question.dayKey ? { dayKey: question.dayKey } : {}),
    };
  }

  async findTodayQuestion(now = new Date()): Promise<PublicQuestion> {
    return this.toPublicQuestion(await this.ensureTodayQuestion(now));
  }

  async findRandomQuestion(
    _userId?: Types.ObjectId,
    _excludeKey?: string,
  ): Promise<PublicQuestion> {
    void _userId;
    void _excludeKey;
    return this.findTodayQuestion();
  }

  async findPublicQuestion(key: string): Promise<PublicQuestion> {
    return this.toPublicQuestion(await this.findQuestion(key));
  }

  async findPreviousUnansweredQuestion(
    user: Express.User,
    before?: string,
    now = new Date(),
  ): Promise<PublicQuestion | null> {
    const beforeDay = before ?? questionDayKey(now, this.timeZone);
    this.assertDayKey(beforeDay);
    const answeredQuestionIds = await this.answerModel
      .distinct('question', { user: user._id })
      .exec();
    const question = await this.questionModel
      .findOne({
        active: true,
        source: 'gpt',
        dayKey: { $lt: beforeDay },
        ...(answeredQuestionIds.length
          ? { _id: { $nin: answeredQuestionIds } }
          : {}),
      })
      .sort({ dayKey: -1 })
      .exec();
    return question ? this.toPublicQuestion(question) : null;
  }

  async submitAnswer(
    key: string,
    user: Express.User,
    value: number,
  ): Promise<QuestionResult> {
    const question = await this.findQuestion(key);
    const normalizedValue = this.validateValue(question, value);

    try {
      await this.answerModel.create({
        user: user._id,
        question: question._id,
        value: normalizedValue,
      });
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }
      const existingAnswer = await this.answerModel
        .findOne({ user: user._id, question: question._id })
        .exec();
      if (!existingAnswer || existingAnswer.value !== normalizedValue) {
        throw new ConflictException({
          code: 'ANSWER_ALREADY_SUBMITTED',
          message: 'Your first answer is already locked in.',
        });
      }
    }

    return this.buildResult(question, user._id);
  }

  async getResult(key: string, user: Express.User): Promise<QuestionResult> {
    const question = await this.findQuestion(key);
    const hasAnswered = await this.answerModel.exists({
      user: user._id,
      question: question._id,
    });
    if (!hasAnswered) {
      throw new ForbiddenException({
        code: 'ANSWER_REQUIRED',
        message: 'Answer this question before seeing the crowd.',
      });
    }
    return this.buildResult(question, user._id);
  }

  private async ensureTodayQuestion(
    now = new Date(),
  ): Promise<QuestionDocument> {
    const dayKey = questionDayKey(now, this.timeZone);
    const existing = await this.questionModel
      .findOne({ dayKey, active: true })
      .exec();
    if (existing) return existing;

    const acquired = await this.acquireGenerationLease(dayKey, now);
    if (!acquired) {
      const completed = await this.questionModel
        .findOne({ dayKey, active: true })
        .exec();
      if (completed) return completed;
      throw this.pendingQuestion();
    }

    try {
      const previousDay = previousQuestionDay(dayKey);
      const previousDayVisitors = await this.visitModel
        .countDocuments({ dayKey: previousDay })
        .exec();
      const recentQuestions = await this.questionModel
        .find({ active: true, source: 'gpt' })
        .sort({ dayKey: -1 })
        .limit(RECENT_PROMPT_LIMIT)
        .select({ prompt: 1 })
        .lean()
        .exec();
      const recentPrompts = recentQuestions.map((question) => question.prompt);
      const allAvoidedPrompts = [
        ...recentPrompts,
        ...QUESTION_CATALOG.map((question) => question.prompt),
      ];

      let generated: GeneratedQuestion | undefined;
      let rejectionReason: string | undefined;
      let generationError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          generated = await this.generator.generate(
            dayKey,
            recentPrompts,
            rejectionReason,
          );
        } catch (error) {
          generationError = error;
          rejectionReason = 'The generation request did not complete.';
          continue;
        }
        rejectionReason = validateGeneratedQuestion(
          generated.candidate,
          allAvoidedPrompts,
        );
        if (!rejectionReason) break;
        generated = undefined;
      }
      if (!generated) {
        if (generationError instanceof Error) throw generationError;
        if (generationError) {
          throw new Error('OPENAI_GENERATION_FAILED');
        }
        throw new Error(
          `OPENAI_CANDIDATE_REJECTED:${rejectionReason ?? 'unknown'}`,
        );
      }

      const question = await this.createGeneratedQuestion(
        dayKey,
        generated,
        requiredAnswerCount(previousDayVisitors),
      );
      await this.generationModel
        .updateOne(
          { dayKey },
          {
            $set: {
              status: 'ready',
              leaseExpiresAt: now,
            },
            $unset: { nextRetryAt: '', lastErrorCode: '' },
          },
        )
        .exec();
      return question;
    } catch (error) {
      await this.generationModel
        .updateOne(
          { dayKey },
          {
            $set: {
              status: 'failed',
              leaseExpiresAt: now,
              nextRetryAt: new Date(now.getTime() + GENERATION_RETRY_MS),
              lastErrorCode: this.errorCode(error),
            },
          },
        )
        .exec();
      this.logger.error(
        `Daily question generation failed for ${dayKey}: ${this.errorCode(error)}`,
      );
      throw this.pendingQuestion();
    }
  }

  private async acquireGenerationLease(
    dayKey: string,
    now: Date,
  ): Promise<boolean> {
    const leaseExpiresAt = new Date(now.getTime() + GENERATION_LEASE_MS);
    const reclaimed = await this.generationModel
      .findOneAndUpdate(
        {
          dayKey,
          $or: [
            { status: 'ready' },
            { status: 'generating', leaseExpiresAt: { $lte: now } },
            { status: 'failed', nextRetryAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: 'generating',
            leaseExpiresAt,
          },
          $inc: { attemptCount: 1 },
          $unset: { nextRetryAt: '', lastErrorCode: '' },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (reclaimed) return true;

    try {
      await this.generationModel.create({
        dayKey,
        status: 'generating',
        leaseExpiresAt,
        attemptCount: 1,
      });
      return true;
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      return false;
    }
  }

  private async createGeneratedQuestion(
    dayKey: string,
    generated: GeneratedQuestion,
    unlockCount: number,
  ): Promise<QuestionDocument> {
    const answerStyle = generated.candidate.answerStyle;
    try {
      return await this.questionModel.create({
        key: `daily-${dayKey}`,
        prompt: generated.candidate.prompt.trim(),
        unit: generated.candidate.unit.trim().toLowerCase(),
        minimum: 0,
        maximum: generated.candidate.maximum,
        step: answerStyle === 'whole' ? 1 : 0.1,
        precision: answerStyle === 'whole' ? 0 : 1,
        active: true,
        dayKey,
        source: 'gpt',
        requiredAnswerCount: unlockCount,
        generationModel: generated.model,
        generationResponseId: generated.responseId,
        promptVersion: QUESTION_PROMPT_VERSION,
        generatedAt: new Date(),
      });
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const existing = await this.questionModel
        .findOne({ dayKey, active: true })
        .exec();
      if (!existing) throw error;
      return existing;
    }
  }

  private async findQuestion(key: string): Promise<QuestionDocument> {
    const question = await this.questionModel
      .findOne({ key, active: true })
      .exec();
    if (!question) {
      throw new NotFoundException({
        code: 'QUESTION_NOT_FOUND',
        message: 'That question is no longer available.',
      });
    }
    return question;
  }

  private validateValue(question: Question, value: number): number {
    if (!Number.isFinite(value)) {
      throw new BadRequestException({
        code: 'INVALID_ANSWER',
        message: 'Enter a real number.',
      });
    }
    if (value < question.minimum || value > question.maximum) {
      throw new BadRequestException({
        code: 'ANSWER_OUT_OF_RANGE',
        message: `Enter a number from ${question.minimum} to ${question.maximum}.`,
      });
    }

    const scale = 10 ** question.precision;
    const normalized = Math.round(value * scale) / scale;
    const stepsFromMinimum = (normalized - question.minimum) / question.step;
    if (
      Math.abs(normalized - value) > 1 / (scale * 1_000_000) ||
      Math.abs(stepsFromMinimum - Math.round(stepsFromMinimum)) > 1e-8
    ) {
      throw new BadRequestException({
        code: 'INVALID_PRECISION',
        message:
          question.precision === 0
            ? 'Enter a whole number.'
            : `Enter no more than ${question.precision} decimal place.`,
      });
    }

    return normalized;
  }

  private async buildResult(
    question: QuestionDocument,
    currentUserId: Types.ObjectId,
  ): Promise<QuestionResult> {
    const [answerCount, currentAnswer] = await Promise.all([
      this.answerModel.countDocuments({ question: question._id }).exec(),
      this.answerModel
        .findOne({ question: question._id, user: currentUserId })
        .lean()
        .exec(),
    ]);
    if (!currentAnswer) {
      throw new ForbiddenException({
        code: 'ANSWER_REQUIRED',
        message: 'Answer this question before seeing the crowd.',
      });
    }
    const unlockCount = question.requiredAnswerCount ?? 1;
    if (answerCount < unlockCount) {
      return {
        status: 'locked',
        question: this.toPublicQuestion(question),
        userAnswer: currentAnswer.value,
        answerCount,
        requiredAnswerCount: unlockCount,
        remainingAnswerCount: unlockCount - answerCount,
      };
    }
    return this.buildUnlockedResult(question, currentUserId, unlockCount);
  }

  private async buildUnlockedResult(
    question: QuestionDocument,
    currentUserId: Types.ObjectId,
    unlockCount: number,
  ): Promise<UnlockedQuestionResult> {
    const answers = (await this.answerModel
      .find({ question: question._id })
      .sort({ createdAt: 1, _id: 1 })
      .populate<{ user: User & { _id: Types.ObjectId } }>('user')
      .lean()
      .exec()) as unknown as PopulatedAnswer[];

    const average =
      answers.reduce((total, answer) => total + answer.value, 0) /
      answers.length;
    const currentUserIdString = currentUserId.toString();

    const sortedEntries: RankedAnswer[] = answers
      .map((answer) => ({
        userId: answer.user._id.toString(),
        displayName: this.displayName(answer.user),
        ...(answer.user.avatarUrl ? { avatarUrl: answer.user.avatarUrl } : {}),
        value: answer.value,
        distanceFromAverage: Math.abs(answer.value - average),
        isCurrentUser: answer.user._id.toString() === currentUserIdString,
        createdAt: answer.createdAt,
        rank: 0,
      }))
      .sort(
        (left, right) =>
          left.distanceFromAverage - right.distanceFromAverage ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.userId.localeCompare(right.userId),
      );

    let previousDistance: number | undefined;
    let previousRank = 0;
    const ranked = sortedEntries.map((entry, index) => {
      const isTie =
        previousDistance !== undefined &&
        Math.abs(entry.distanceFromAverage - previousDistance) < 1e-9;
      if (!isTie) {
        previousRank = index + 1;
        previousDistance = entry.distanceFromAverage;
      }
      return { ...entry, rank: previousRank };
    });

    const winner = ranked[0];
    const currentUserEntry = ranked.find((entry) => entry.isCurrentUser);
    if (!winner || !currentUserEntry) {
      throw new ForbiddenException({
        code: 'ANSWER_REQUIRED',
        message: 'Answer this question before seeing the crowd.',
      });
    }
    const winningEntry = this.publicEntry(winner);

    return {
      status: 'unlocked',
      question: this.toPublicQuestion(question),
      average,
      answerCount: answers.length,
      requiredAnswerCount: unlockCount,
      remainingAnswerCount: 0,
      leaders: ranked.slice(0, 5).map((entry) => this.publicEntry(entry)),
      userEntry: {
        ...this.publicEntry(currentUserEntry),
        distanceToWinner: Math.abs(currentUserEntry.value - winningEntry.value),
      },
      winningEntry,
      computedAt: new Date().toISOString(),
    };
  }

  private publicEntry(entry: RankedAnswer): LeaderboardEntry {
    return {
      rank: entry.rank,
      displayName: entry.displayName,
      ...(entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}),
      value: entry.value,
      distanceFromAverage: entry.distanceFromAverage,
      isCurrentUser: entry.isCurrentUser,
    };
  }

  private displayName(user: User): string {
    return user.lastInitial
      ? `${user.firstName} ${user.lastInitial.toUpperCase()}.`
      : user.firstName;
  }

  private assertDayKey(dayKey: string): void {
    try {
      previousQuestionDay(dayKey);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_DAY_KEY',
        message: 'The previous-question date must use YYYY-MM-DD.',
      });
    }
  }

  private pendingQuestion(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'DAILY_QUESTION_PENDING',
      message: 'Today’s question is still being prepared. Try again shortly.',
      retryAfterSeconds: GENERATION_RETRY_MS / 1_000,
    });
  }

  private errorCode(error: unknown): string {
    if (error instanceof Error) {
      return error.message
        .split(':')[0]
        .replace(/[^A-Za-z0-9_]/g, '_')
        .slice(0, 80);
    }
    return 'UNKNOWN_GENERATION_ERROR';
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}

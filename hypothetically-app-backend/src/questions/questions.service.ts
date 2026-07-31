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
import { buildAnswerClusters } from './answer-clusters';
import { validateGeneratedQuestion } from './question-candidate';
import {
  canonicalTimeZone,
  dailyQuestionUnlockAt,
  DEFAULT_QUESTION_TIME_ZONE,
  isQuestionGenerationHour,
  previousQuestionDay,
  questionDayKey,
} from './question-day';
import {
  GeneratedQuestion,
  QUESTION_PROMPT_VERSION,
  QuestionGenerationService,
} from './question-generation.service';
import {
  LeaderboardEntry,
  ArchiveResponse,
  PublicQuestion,
  QuestionResult,
  UnlockedQuestionResult,
} from './question.types';
import {
  isQuestionTopic,
  QUESTION_TOPIC_VALUES,
  questionTopic,
} from './question-topic';
import { Answer } from './schemas/answer.schema';
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
    user: Express.User,
    excludeKey?: string,
  ): Promise<PublicQuestion | null> {
    const answeredQuestionIds = await this.answerModel
      .distinct('question', { user: user._id })
      .exec();
    const questions = await this.questionModel
      .find({
        active: true,
        ...(answeredQuestionIds.length
          ? { _id: { $nin: answeredQuestionIds } }
          : {}),
        ...(excludeKey ? { key: { $ne: excludeKey } } : {}),
      })
      .exec();
    if (questions.length === 0) return null;
    const question = questions[Math.floor(Math.random() * questions.length)];
    return this.toPublicQuestion(question);
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

  async findArchive(
    user: Express.User,
    status: string = 'all',
    topic: string = 'all',
    now = new Date(),
  ): Promise<ArchiveResponse> {
    if (!['all', 'answered', 'unanswered'].includes(status)) {
      throw new BadRequestException({
        code: 'INVALID_ARCHIVE_STATUS',
        message: 'Choose all, answered, or unanswered questions.',
      });
    }
    if (topic !== 'all' && !isQuestionTopic(topic)) {
      throw new BadRequestException({
        code: 'INVALID_ARCHIVE_TOPIC',
        message: `Choose one of these topics: ${QUESTION_TOPIC_VALUES.join(', ')}.`,
      });
    }

    const today = questionDayKey(now, this.timeZone);
    const questions = await this.questionModel
      .find({
        active: true,
        $or: [{ dayKey: { $lt: today } }, { dayKey: { $exists: false } }],
      })
      .sort({ dayKey: -1, createdAt: -1 })
      .exec();
    const questionIds = questions.map((question) => question._id);
    const answers = await this.answerModel
      .find({ user: user._id, question: { $in: questionIds } })
      .select({ question: 1 })
      .lean()
      .exec();
    const answeredIds = new Set(
      answers.map((answer) => answer.question.toString()),
    );

    const archiveQuestions = questions
      .map((question) => ({
        ...this.toPublicQuestion(question),
        topic: questionTopic(question),
        answered: answeredIds.has(question._id.toString()),
      }))
      .filter((question) => {
        const matchesStatus =
          status === 'all' ||
          (status === 'answered' && question.answered) ||
          (status === 'unanswered' && !question.answered);
        const matchesTopic = topic === 'all' || question.topic === topic;
        return matchesStatus && matchesTopic;
      });

    return {
      questions: archiveQuestions,
      total: archiveQuestions.length,
    };
  }

  async submitAnswer(
    key: string,
    user: Express.User,
    value: number,
    timeZone?: string,
    now = new Date(),
  ): Promise<QuestionResult> {
    const question = await this.findQuestion(key);
    const normalizedValue = this.validateValue(question, value);
    const answerTimeZone = this.requestTimeZone(timeZone);

    try {
      await this.answerModel.create({
        user: user._id,
        question: question._id,
        value: normalizedValue,
        timeZone: answerTimeZone,
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

    return this.buildResult(question, user._id, answerTimeZone, now);
  }

  async getResult(
    key: string,
    user: Express.User,
    timeZone?: string,
    now = new Date(),
  ): Promise<QuestionResult> {
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
    return this.buildResult(
      question,
      user._id,
      this.requestTimeZone(timeZone),
      now,
    );
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
        throw new Error(`OPENAI_CANDIDATE_REJECTED:${rejectionReason!}`);
      }

      const question = await this.createGeneratedQuestion(dayKey, generated);
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
    requestedTimeZone: string,
    now: Date,
  ): Promise<QuestionResult> {
    const currentAnswer = await this.answerModel
      .findOne({ question: question._id, user: currentUserId })
      .lean()
      .exec();
    if (!currentAnswer) {
      throw new ForbiddenException({
        code: 'ANSWER_REQUIRED',
        message: 'Answer this question before seeing the crowd.',
      });
    }
    const answerTimeZone = await this.answerTimeZone(
      currentAnswer._id,
      currentAnswer.timeZone,
      requestedTimeZone,
    );
    if (question.dayKey) {
      const unlocksAt = dailyQuestionUnlockAt(question.dayKey, answerTimeZone);
      if (now.getTime() < unlocksAt.getTime()) {
        return {
          status: 'locked',
          question: this.toPublicQuestion(question),
          userAnswer: currentAnswer.value,
          unlocksAt: unlocksAt.toISOString(),
          timeZone: answerTimeZone,
        };
      }
    }
    return this.buildUnlockedResult(question, currentUserId);
  }

  private async answerTimeZone(
    answerId: Types.ObjectId,
    storedTimeZone: string | undefined,
    requestedTimeZone: string,
  ): Promise<string> {
    if (storedTimeZone) {
      try {
        return canonicalTimeZone(storedTimeZone);
      } catch {
        return this.timeZone;
      }
    }

    await this.answerModel
      .updateOne(
        {
          _id: answerId,
          $or: [
            { timeZone: { $exists: false } },
            { timeZone: null },
            { timeZone: '' },
          ],
        },
        { $set: { timeZone: requestedTimeZone } },
      )
      .exec();
    const claimed = await this.answerModel
      .findById(answerId)
      .select({ timeZone: 1 })
      .lean()
      .exec();
    return claimed?.timeZone
      ? canonicalTimeZone(claimed.timeZone)
      : requestedTimeZone;
  }

  private requestTimeZone(timeZone?: string): string {
    if (timeZone === undefined) {
      return this.timeZone;
    }
    try {
      return canonicalTimeZone(timeZone);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_TIME_ZONE',
        message: 'Use a valid IANA time zone.',
      });
    }
  }

  private async buildUnlockedResult(
    question: QuestionDocument,
    currentUserId: Types.ObjectId,
  ): Promise<UnlockedQuestionResult> {
    const answers = (await this.answerModel
      .find({ question: question._id })
      .sort({ createdAt: 1, _id: 1 })
      .populate<{ user: User & { _id: Types.ObjectId } }>('user')
      .lean()
      .exec()) as unknown as PopulatedAnswer[];

    const sortedValues = answers
      .map((answer) => answer.value)
      .sort((left, right) => left - right);
    const middleIndex = Math.floor(sortedValues.length / 2);
    const median =
      sortedValues.length % 2 === 1
        ? sortedValues[middleIndex]
        : (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
    const currentUserIdString = currentUserId.toString();

    const sortedEntries: RankedAnswer[] = answers
      .map((answer) => ({
        userId: answer.user._id.toString(),
        displayName: this.displayName(answer.user),
        ...(answer.user.avatarUrl ? { avatarUrl: answer.user.avatarUrl } : {}),
        value: answer.value,
        distanceFromMedian: Math.abs(answer.value - median),
        isCurrentUser: answer.user._id.toString() === currentUserIdString,
        createdAt: answer.createdAt,
        rank: 0,
      }))
      .sort(
        (left, right) =>
          left.distanceFromMedian - right.distanceFromMedian ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.userId.localeCompare(right.userId),
      );

    let previousDistance: number | undefined;
    let previousRank = 0;
    const ranked = sortedEntries.map((entry, index) => {
      const isTie =
        previousDistance !== undefined &&
        Math.abs(entry.distanceFromMedian - previousDistance) < 1e-9;
      if (!isTie) {
        previousRank = index + 1;
        previousDistance = entry.distanceFromMedian;
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
      median,
      answerCount: answers.length,
      answerClusters: buildAnswerClusters(sortedValues, question.step),
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
      distanceFromMedian: entry.distanceFromMedian,
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

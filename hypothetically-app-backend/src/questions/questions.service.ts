import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { QUESTION_CATALOG } from './question.catalog';
import {
  LeaderboardEntry,
  PublicQuestion,
  QuestionResult,
} from './question.types';
import { Answer } from './schemas/answer.schema';
import { Question, QuestionDocument } from './schemas/question.schema';

interface PopulatedAnswer {
  user: User & { _id: Types.ObjectId };
  value: number;
  createdAt: Date;
}

interface RankedAnswer extends LeaderboardEntry {
  userId: string;
  createdAt: Date;
}

@Injectable()
export class QuestionsService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<Question>,
    @InjectModel(Answer.name)
    private readonly answerModel: Model<Answer>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.questionModel.bulkWrite(
      QUESTION_CATALOG.map((question) => ({
        updateOne: {
          filter: { key: question.key },
          update: { $set: question },
          upsert: true,
        },
      })),
    );
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
    };
  }

  async findPublicQuestion(key: string): Promise<PublicQuestion> {
    return this.toPublicQuestion(await this.findQuestion(key));
  }

  async findRandomQuestion(
    userId?: Types.ObjectId,
    excludeKey?: string,
  ): Promise<PublicQuestion | null> {
    const answeredQuestionIds = userId
      ? await this.answerModel.distinct('question', { user: userId }).exec()
      : [];
    const match: Record<string, unknown> = {
      active: true,
      ...(answeredQuestionIds.length > 0
        ? { _id: { $nin: answeredQuestionIds } }
        : {}),
      ...(excludeKey ? { key: { $ne: excludeKey } } : {}),
    };
    const [question] = await this.questionModel
      .aggregate<Question>([{ $match: match }, { $sample: { size: 1 } }])
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
      question: this.toPublicQuestion(question),
      average,
      answerCount: answers.length,
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

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}

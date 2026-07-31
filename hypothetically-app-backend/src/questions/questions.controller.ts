import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import type {
  ArchiveResponse,
  PublicQuestion,
  QuestionResult,
} from './question.types';
import { QuestionsService } from './questions.service';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get('random')
  @UseGuards(SessionAuthGuard)
  async random(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('exclude') exclude?: string,
  ): Promise<PublicQuestion | undefined | null> {
    const question = await this.questionsService.findRandomQuestion(
      request.user!,
      exclude,
    );
    if (!question) {
      response.status(204);
      return undefined;
    }
    response.setHeader('Cache-Control', 'no-store');
    return question;
  }

  @Get('archive')
  @UseGuards(SessionAuthGuard)
  async archive(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('status') status?: string,
    @Query('topic') topic?: string,
  ): Promise<ArchiveResponse> {
    response.setHeader('Cache-Control', 'no-store');
    return this.questionsService.findArchive(request.user!, status, topic);
  }

  @Get('today')
  async today(
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicQuestion> {
    response.setHeader('Cache-Control', 'no-store');
    return this.questionsService.findTodayQuestion();
  }

  @Get('previous-unanswered')
  @UseGuards(SessionAuthGuard)
  async previousUnanswered(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('before') before?: string,
  ): Promise<PublicQuestion | undefined> {
    const question = await this.questionsService.findPreviousUnansweredQuestion(
      request.user!,
      before,
    );
    if (!question) {
      response.status(204);
      return undefined;
    }
    response.setHeader('Cache-Control', 'no-store');
    return question;
  }

  @Get(':key')
  async question(@Param('key') key: string): Promise<PublicQuestion> {
    return this.questionsService.findPublicQuestion(key);
  }

  @Post(':key/answer')
  @UseGuards(SessionAuthGuard)
  async answer(
    @Param('key') key: string,
    @Req() request: Request,
    @Body() body: SubmitAnswerDto,
  ): Promise<QuestionResult> {
    return this.questionsService.submitAnswer(
      key,
      request.user!,
      body.value,
      body.timeZone,
    );
  }

  @Get(':key/results')
  @UseGuards(SessionAuthGuard)
  async results(
    @Param('key') key: string,
    @Req() request: Request,
    @Query('timeZone') timeZone?: string,
  ): Promise<QuestionResult> {
    return this.questionsService.getResult(key, request.user!, timeZone);
  }
}

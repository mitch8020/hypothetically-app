import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { Answer, AnswerSchema } from './schemas/answer.schema';
import { DailyVisit, DailyVisitSchema } from './schemas/daily-visit.schema';
import { Question, QuestionSchema } from './schemas/question.schema';
import {
  QuestionGeneration,
  QuestionGenerationSchema,
} from './schemas/question-generation.schema';
import { QuestionGenerationService } from './question-generation.service';
import { TrafficController } from './traffic.controller';
import { TrafficService } from './traffic.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Question.name, schema: QuestionSchema },
      { name: Answer.name, schema: AnswerSchema },
      { name: DailyVisit.name, schema: DailyVisitSchema },
      {
        name: QuestionGeneration.name,
        schema: QuestionGenerationSchema,
      },
    ]),
    AuthModule,
  ],
  controllers: [QuestionsController, TrafficController],
  providers: [QuestionsService, QuestionGenerationService, TrafficService],
  exports: [QuestionsService],
})
export class QuestionsModule {}

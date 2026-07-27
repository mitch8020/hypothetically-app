import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { Question } from './question.schema';

export type AnswerDocument = HydratedDocument<Answer>;

@Schema({ timestamps: true })
export class Answer {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: Question.name,
    required: true,
    index: true,
  })
  question!: Types.ObjectId;

  @Prop({ required: true })
  value!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AnswerSchema = SchemaFactory.createForClass(Answer);
AnswerSchema.index({ user: 1, question: 1 }, { unique: true });

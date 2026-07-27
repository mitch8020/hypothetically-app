import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuestionDocument = HydratedDocument<Question>;

@Schema({ timestamps: true })
export class Question {
  @Prop({ required: true, unique: true, index: true, trim: true })
  key!: string;

  @Prop({ required: true, trim: true, maxlength: 280 })
  prompt!: string;

  @Prop({ required: true, trim: true, maxlength: 40 })
  unit!: string;

  @Prop({ required: true, min: 0 })
  minimum!: number;

  @Prop({ required: true, min: 0 })
  maximum!: number;

  @Prop({ required: true, min: 0.000001 })
  step!: number;

  @Prop({ required: true, min: 0, max: 6 })
  precision!: number;

  @Prop({ required: true, default: true, index: true })
  active!: boolean;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

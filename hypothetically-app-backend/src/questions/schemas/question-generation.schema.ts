import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuestionGenerationDocument = HydratedDocument<QuestionGeneration>;

export type QuestionGenerationStatus = 'generating' | 'ready' | 'failed';

@Schema({ timestamps: true })
export class QuestionGeneration {
  @Prop({ required: true, unique: true, index: true })
  dayKey!: string;

  @Prop({
    required: true,
    enum: ['generating', 'ready', 'failed'],
    default: 'generating',
  })
  status!: QuestionGenerationStatus;

  @Prop({ required: true })
  leaseExpiresAt!: Date;

  @Prop()
  nextRetryAt?: Date;

  @Prop({ required: true, default: 1 })
  attemptCount!: number;

  @Prop()
  lastErrorCode?: string;
}

export const QuestionGenerationSchema =
  SchemaFactory.createForClass(QuestionGeneration);

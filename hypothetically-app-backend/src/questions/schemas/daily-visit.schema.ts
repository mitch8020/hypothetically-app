import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DailyVisitDocument = HydratedDocument<DailyVisit>;

@Schema({ timestamps: true })
export class DailyVisit {
  @Prop({ required: true, index: true })
  dayKey!: string;

  @Prop({ required: true })
  visitorHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;
}

export const DailyVisitSchema = SchemaFactory.createForClass(DailyVisit);
DailyVisitSchema.index({ dayKey: 1, visitorHash: 1 }, { unique: true });
DailyVisitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

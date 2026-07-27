import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true, trim: true })
  googleSubject!: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  firstName!: string;

  @Prop({ required: true, trim: true, maxlength: 1, default: '' })
  lastInitial!: string;

  @Prop({ trim: true })
  avatarUrl?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

export interface GoogleProfileInput {
  googleSubject: string;
  firstName: string;
  lastInitial: string;
  avatarUrl?: string;
}

export interface PublicUser {
  firstName: string;
  lastInitial: string;
  displayName: string;
  avatarUrl?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async upsertGoogleProfile(
    profile: GoogleProfileInput,
  ): Promise<UserDocument> {
    return this.userModel
      .findOneAndUpdate(
        { googleSubject: profile.googleSubject },
        { $set: profile },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .orFail()
      .exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.userModel.findById(id).exec();
  }

  toPublicUser(user: Express.User): PublicUser {
    const lastInitial = user.lastInitial.toUpperCase();
    return {
      firstName: user.firstName,
      lastInitial,
      displayName: lastInitial
        ? `${user.firstName} ${lastInitial}.`
        : user.firstName,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };
  }
}

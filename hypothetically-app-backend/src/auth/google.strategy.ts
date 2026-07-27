import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Profile } from 'passport-google-oauth20';
import { Strategy } from 'passport-google-oauth20';
import { UsersService } from '../users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['openid', 'profile'],
      state: true,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<Express.User> {
    const firstName =
      profile.name?.givenName?.trim() ||
      profile.displayName.trim().split(/\s+/)[0] ||
      'Player';
    const lastInitial = (
      profile.name?.familyName?.trim()[0] ?? ''
    ).toUpperCase();

    return this.usersService.upsertGoogleProfile({
      googleSubject: profile.id,
      firstName,
      lastInitial,
      ...(profile.photos?.[0]?.value
        ? { avatarUrl: profile.photos[0].value }
        : {}),
    });
  }
}

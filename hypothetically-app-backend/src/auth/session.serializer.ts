import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { UsersService } from '../users/users.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private readonly usersService: UsersService) {
    super();
  }

  serializeUser(
    user: Express.User,
    done: (error: Error | null, id?: string) => void,
  ): void {
    done(null, user._id.toString());
  }

  async deserializeUser(
    id: string,
    done: (error: Error | null, user?: Express.User | false) => void,
  ): Promise<void> {
    try {
      const user = await this.usersService.findById(id);
      done(null, user ?? false);
    } catch (error) {
      done(error as Error);
    }
  }
}

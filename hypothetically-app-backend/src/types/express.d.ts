import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface User {
      _id: Types.ObjectId;
      googleSubject: string;
      firstName: string;
      lastInitial: string;
      avatarUrl?: string;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    returnTo?: string;
  }
}

export {};

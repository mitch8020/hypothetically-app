export interface PublicQuestion {
  key: string;
  prompt: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
  precision: number;
  dayKey?: string;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  avatarUrl?: string;
  value: number;
  distanceFromAverage: number;
  isCurrentUser: boolean;
}

export interface LockedQuestionResult {
  status: 'locked';
  question: PublicQuestion;
  userAnswer: number;
  answerCount: number;
  requiredAnswerCount: number;
  remainingAnswerCount: number;
}

export interface UnlockedQuestionResult {
  status: 'unlocked';
  question: PublicQuestion;
  average: number;
  answerCount: number;
  requiredAnswerCount: number;
  remainingAnswerCount: 0;
  leaders: LeaderboardEntry[];
  userEntry: LeaderboardEntry & { distanceToWinner: number };
  winningEntry: LeaderboardEntry;
  computedAt: string;
}

export type QuestionResult = LockedQuestionResult | UnlockedQuestionResult;

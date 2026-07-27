export interface PublicQuestion {
  key: string;
  prompt: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
  precision: number;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  avatarUrl?: string;
  value: number;
  distanceFromAverage: number;
  isCurrentUser: boolean;
}

export interface QuestionResult {
  question: PublicQuestion;
  average: number;
  answerCount: number;
  leaders: LeaderboardEntry[];
  userEntry: LeaderboardEntry & { distanceToWinner: number };
  winningEntry: LeaderboardEntry;
  computedAt: string;
}

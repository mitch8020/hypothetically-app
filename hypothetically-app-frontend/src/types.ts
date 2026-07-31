export interface PublicUser {
  firstName: string
  lastInitial: string
  displayName: string
  avatarUrl?: string
}

export interface PublicQuestion {
  key: string
  prompt: string
  unit: string
  minimum: number
  maximum: number
  step: number
  precision: number
  dayKey?: string
}

export const QUESTION_TOPIC_VALUES = [
  'food',
  'sports',
  'home',
  'everyday',
  'creative',
  'nature',
  'other',
] as const

export type QuestionTopic = (typeof QUESTION_TOPIC_VALUES)[number]
export type ArchiveStatus = 'all' | 'answered' | 'unanswered'

export interface ArchiveQuestion extends PublicQuestion {
  topic: QuestionTopic
  answered: boolean
}

export interface ArchiveResponse {
  questions: ArchiveQuestion[]
  total: number
}

export interface LeaderboardEntry {
  rank: number
  displayName: string
  avatarUrl?: string
  value: number
  distanceFromMedian: number
  isCurrentUser: boolean
}

export interface AnswerCluster {
  center: number
  count: number
  minimum: number
  maximum: number
}

export interface LockedQuestionResult {
  status: 'locked'
  question: PublicQuestion
  userAnswer: number
  unlocksAt: string
  timeZone: string
}

export interface UnlockedQuestionResult {
  status: 'unlocked'
  question: PublicQuestion
  median: number
  answerCount: number
  answerClusters: AnswerCluster[]
  leaders: LeaderboardEntry[]
  userEntry: LeaderboardEntry & { distanceToWinner: number }
  winningEntry: LeaderboardEntry
  computedAt: string
}

export type QuestionResult = LockedQuestionResult | UnlockedQuestionResult

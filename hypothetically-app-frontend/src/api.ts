import type { PublicQuestion, PublicUser, QuestionResult } from './types'

interface ErrorBody {
  code?: string
  message?: string | string[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(
    message: string,
    status: number,
    code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
  })

  if (response.status === 204) {
    return null
  }

  const body = (await response.json().catch(() => null)) as
    | T
    | ErrorBody
    | null
  if (!response.ok) {
    const errorBody = body as ErrorBody | null
    const rawMessage = errorBody?.message
    const message = Array.isArray(rawMessage)
      ? rawMessage[0]
      : rawMessage || 'Something interrupted that guess.'
    throw new ApiError(message, response.status, errorBody?.code)
  }

  return body as T
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const response = await request<{ user: PublicUser | null }>('/api/auth/me')
  return response?.user ?? null
}

export async function signOut(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' })
}

export async function recordVisit(): Promise<void> {
  await request('/api/traffic/visit', { method: 'POST' })
}

export async function getTodayQuestion(): Promise<PublicQuestion> {
  const question = await request<PublicQuestion>('/api/questions/today')
  if (!question) {
    throw new ApiError('Today’s question is still being prepared.', 503)
  }
  return question
}

export async function getPreviousUnansweredQuestion(
  before?: string,
): Promise<PublicQuestion | null> {
  const search = before ? `?before=${encodeURIComponent(before)}` : ''
  return request<PublicQuestion>(
    `/api/questions/previous-unanswered${search}`,
  )
}

export async function getQuestion(key: string): Promise<PublicQuestion> {
  const question = await request<PublicQuestion>(
    `/api/questions/${encodeURIComponent(key)}`,
  )
  if (!question) {
    throw new ApiError('That question is no longer available.', 404)
  }
  return question
}

export async function submitAnswer(
  key: string,
  value: number,
): Promise<QuestionResult> {
  const result = await request<QuestionResult>(
    `/api/questions/${encodeURIComponent(key)}/answer`,
    {
      method: 'POST',
      body: JSON.stringify({ value }),
    },
  )
  if (!result) {
    throw new ApiError('The result did not arrive.', 500)
  }
  return result
}

export async function getResult(key: string): Promise<QuestionResult> {
  const result = await request<QuestionResult>(
    `/api/questions/${encodeURIComponent(key)}/results`,
  )
  if (!result) {
    throw new ApiError('The result did not arrive.', 500)
  }
  return result
}

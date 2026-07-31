import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  browserTimeZone,
  getCurrentUser,
  getPreviousUnansweredQuestion,
  getQuestion,
  getResult,
  getTodayQuestion,
  recordVisit,
  signOut,
  submitAnswer,
} from './api'

const question = {
  key: 'daily-2026-07-28',
  prompt: 'How many doors?',
  unit: 'doors',
  minimum: 0,
  maximum: 100,
  step: 1,
  precision: 0,
  dayKey: '2026-07-28',
}

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('frontend API client', () => {
  it('exposes the browser timezone and uses Chicago when the browser omits one', () => {
    expect(browserTimeZone()).toBeTruthy()

    const original = Intl.DateTimeFormat
    class FallbackDateTimeFormat {
      constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
        if (args.length === 0) {
          return { resolvedOptions: () => ({ timeZone: '' }) } as Intl.DateTimeFormat
        }
        return new original(...args)
      }
    }
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(FallbackDateTimeFormat as unknown as typeof Intl.DateTimeFormat)
    expect(browserTimeZone()).toBe('America/Chicago')
  })

  it('constructs ApiError with its status and optional code', () => {
    const error = new ApiError('nope', 418, 'TEAPOT')
    expect(error).toMatchObject({ name: 'ApiError', message: 'nope', status: 418, code: 'TEAPOT' })
    expect(error).toBeInstanceOf(Error)
  })

  it('reads users, records visits, and signs out with credentialed requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ user: null }))
      .mockResolvedValueOnce(response({ user: { firstName: 'A', lastInitial: 'B', displayName: 'A B.' } }))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCurrentUser()).resolves.toBeNull()
    await expect(getCurrentUser()).resolves.toEqual({ firstName: 'A', lastInitial: 'B', displayName: 'A B.' })
    await expect(recordVisit()).resolves.toBeUndefined()
    await expect(signOut()).resolves.toBeUndefined()

    expect(fetchMock.mock.calls).toEqual([
      ['/api/auth/me', expect.objectContaining({ credentials: 'include' })],
      ['/api/auth/me', expect.objectContaining({ credentials: 'include' })],
      ['/api/traffic/visit', expect.objectContaining({ method: 'POST' })],
      ['/api/auth/logout', expect.objectContaining({ method: 'POST' })],
    ])
  })

  it('turns JSON error bodies into ApiErrors and supplies a fallback message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ message: ['first error', 'second error'], code: 'BAD' }, 400))
      .mockResolvedValueOnce(response({ message: 'plain error' }, 500))
      .mockResolvedValueOnce(new Response('not json', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getQuestion('one')).rejects.toMatchObject({ message: 'first error', status: 400, code: 'BAD' })
    await expect(getQuestion('two')).rejects.toMatchObject({ message: 'plain error', status: 500 })
    await expect(getQuestion('three')).rejects.toMatchObject({ message: 'Something interrupted that guess.', status: 502 })
  })

  it('handles today, previous, and encoded question requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(question))
      .mockResolvedValueOnce(response({ code: 'QUESTION_NOT_FOUND' }, 404))
      .mockResolvedValueOnce(response({ ...question, dayKey: undefined }))
      .mockResolvedValueOnce(response({ ...question, dayKey: '2026-07-28' }))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(question))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getTodayQuestion()).resolves.toEqual(question)
    await expect(getTodayQuestion()).resolves.toEqual(expect.objectContaining({ dayKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }))
    await expect(getTodayQuestion()).resolves.toEqual(expect.objectContaining({ dayKey: '2026-07-28' }))
    await expect(getPreviousUnansweredQuestion()).resolves.toBeNull()
    await expect(getPreviousUnansweredQuestion('2026-07-28')).resolves.toEqual(question)
    expect(fetchMock.mock.calls[5][0]).toBe('/api/questions/previous-unanswered?before=2026-07-28')
  })

  it('falls back from a legacy today route and preserves non-legacy failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ code: 'QUESTION_NOT_FOUND', message: 'gone' }, 404))
      .mockResolvedValueOnce(response(question))
      .mockResolvedValueOnce(response({ message: 'unavailable' }, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getTodayQuestion()).resolves.toEqual(expect.objectContaining({ key: question.key, dayKey: question.dayKey }))
    await expect(getTodayQuestion()).rejects.toMatchObject({ message: 'unavailable', status: 503 })
    expect(fetchMock.mock.calls[1][0]).toMatch(/^\/api\/questions\/daily-\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects empty today and question responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(null, 204))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getTodayQuestion()).rejects.toMatchObject({ status: 503 })
    await expect(getQuestion('missing')).rejects.toMatchObject({ message: 'That question is no longer available.', status: 404 })
  })

  it('submits answers and loads results, including null response failures', async () => {
    const result = { status: 'locked', question, userAnswer: 4, unlocksAt: '2099-01-01T00:00:00.000Z', timeZone: 'America/Chicago' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(result, 201))
      .mockResolvedValueOnce(response(result))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitAnswer('daily / key', 4)).resolves.toEqual(result)
    await expect(getResult('daily / key')).resolves.toEqual(result)
    await expect(submitAnswer('empty', 1)).rejects.toMatchObject({ message: 'The result did not arrive.', status: 500 })
    await expect(getResult('empty')).rejects.toMatchObject({ message: 'The result did not arrive.', status: 500 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/questions/daily%20%2F%20key/answer')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ value: 4 })
  })
})

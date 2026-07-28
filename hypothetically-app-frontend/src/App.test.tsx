import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { PublicQuestion, QuestionResult } from './types'

const question: PublicQuestion = {
  key: 'daily-2026-07-28',
  prompt: 'How many doors do you think you’ve opened in your lifetime?',
  unit: 'doors',
  minimum: 0,
  maximum: 1_000_000_000,
  step: 1,
  precision: 0,
  dayKey: '2026-07-28',
}

const unlockedResult: QuestionResult = {
  status: 'unlocked',
  question,
  average: 43.3333333333,
  answerCount: 3,
  requiredAnswerCount: 3,
  remainingAnswerCount: 0,
  leaders: [
    {
      rank: 1,
      displayName: 'Blair B.',
      value: 20,
      distanceFromAverage: 23.3333333333,
      isCurrentUser: false,
    },
    {
      rank: 2,
      displayName: 'Alex A.',
      value: 10,
      distanceFromAverage: 33.3333333333,
      isCurrentUser: true,
    },
    {
      rank: 3,
      displayName: 'Casey C.',
      value: 100,
      distanceFromAverage: 56.6666666667,
      isCurrentUser: false,
    },
  ],
  userEntry: {
    rank: 2,
    displayName: 'Alex A.',
    value: 10,
    distanceFromAverage: 33.3333333333,
    distanceToWinner: 10,
    isCurrentUser: true,
  },
  winningEntry: {
    rank: 1,
    displayName: 'Blair B.',
    value: 20,
    distanceFromAverage: 23.3333333333,
    isCurrentUser: false,
  },
  computedAt: '2026-07-28T12:00:00.000Z',
}

const lockedResult: QuestionResult = {
  status: 'locked',
  question,
  userAnswer: 10,
  answerCount: 1,
  requiredAnswerCount: 3,
  remainingAnswerCount: 2,
}

type FetchHandler = (url: string, init?: RequestInit) => Response

function json(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/traffic/visit' && init?.method === 'POST') {
      return Promise.resolve(json(null, 204))
    }
    return Promise.resolve(handler(url, init))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderApp(initialEntry: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function currentUser() {
  return {
    user: {
      firstName: 'Alex',
      lastInitial: 'A',
      displayName: 'Alex A.',
    },
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  })
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: undefined,
  })
})

describe('How Many, Though? experience', () => {
  it('shows the preserved daily question and Google sign-in prompt to guests', async () => {
    installFetch((url) => {
      if (url === '/api/auth/me') return json({ user: null })
      if (url === `/api/questions/${question.key}`) return json(question)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp(`/q/${question.key}`)

    expect(
      await screen.findByRole('heading', { name: question.prompt }),
    ).toBeInTheDocument()
    expect(screen.getByText('Question of the day')).toBeInTheDocument()
    expect(screen.getByText('Got an answer?')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Sign in with Google' }),
    ).toHaveAttribute(
      'href',
      `/api/auth/google?returnTo=%2Fq%2F${question.key}`,
    )
  })

  it('keeps the question visible after a failed Google callback', async () => {
    installFetch((url) => {
      if (url === '/api/auth/me') return json({ user: null })
      if (url === `/api/questions/${question.key}`) return json(question)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp(`/q/${question.key}?auth=failed`)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Google sign-in didn’t finish',
    )
    expect(
      screen.getByRole('heading', { name: question.prompt }),
    ).toBeInTheDocument()
  })

  it('enforces question precision before sending an answer', async () => {
    const fetchMock = installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === `/api/questions/${question.key}`) return json(question)
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp(`/q/${question.key}`)

    const input = await screen.findByRole('spinbutton', {
      name: 'Your answer',
    })
    await user.type(input, '2.5')
    await user.click(screen.getByRole('button', { name: 'Lock in my answer' }))

    expect(
      await screen.findByText('This one needs a whole number.'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url) === `/api/questions/${question.key}/answer`,
      ),
    ).toBe(false)
  })

  it('submits once and reveals an unlocked crowd snapshot', async () => {
    installFetch((url, init) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === `/api/questions/${question.key}`) return json(question)
      if (
        url === `/api/questions/${question.key}/answer` &&
        init?.method === 'POST'
      ) {
        expect(JSON.parse(String(init.body))).toEqual({ value: 10 })
        return json(unlockedResult, 201)
      }
      if (
        url ===
        '/api/questions/previous-unanswered?before=2026-07-28'
      ) {
        return json(null, 204)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp(`/q/${question.key}`)

    const input = await screen.findByRole('spinbutton', {
      name: 'Your answer',
    })
    await user.type(input, '10')
    await user.click(screen.getByRole('button', { name: 'Lock in my answer' }))

    expect(await screen.findByText('The crowd average')).toBeInTheDocument()
    expect(screen.getByText('43.3')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'The leaderboard' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        'You are caught up. Come back tomorrow for a new question.',
      ),
    ).toBeInTheDocument()
  })

  it('shows a sealed answer, sharing controls, and manually unlocks', async () => {
    let resultChecks = 0
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share,
    })
    installFetch((url, init) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === `/api/questions/${question.key}`) return json(question)
      if (
        url === `/api/questions/${question.key}/answer` &&
        init?.method === 'POST'
      ) {
        return json(lockedResult, 201)
      }
      if (url === `/api/questions/${question.key}/results`) {
        resultChecks += 1
        return json(unlockedResult)
      }
      if (
        url ===
        '/api/questions/previous-unanswered?before=2026-07-28'
      ) {
        return json(null, 204)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    renderApp(`/q/${question.key}`)

    await user.type(
      await screen.findByRole('spinbutton', { name: 'Your answer' }),
      '10',
    )
    await user.click(screen.getByRole('button', { name: 'Lock in my answer' }))

    expect(
      await screen.findByRole('heading', { name: '10 doors' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('1 out of 3 answers in')).toBeInTheDocument()
    expect(screen.getByText(/2 more answers arrive/)).toBeInTheDocument()
    expect(screen.queryByText('The crowd average')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'X' })).toHaveAttribute(
      'href',
      expect.stringContaining('twitter.com/intent/tweet'),
    )
    expect(screen.getByRole('link', { name: 'Facebook' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Share from this device' }),
    )
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(question.prompt),
        url: expect.stringContaining(`/q/${question.key}`),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Copy question link' }))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`/q/${question.key}`),
    )
    expect(await screen.findByText('Question link copied.')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Check if it’s unlocked' }),
    )
    expect(await screen.findByText('The crowd average')).toBeInTheDocument()
    expect(resultChecks).toBe(1)
  })

  it('offers the locked result when a different second answer conflicts', async () => {
    installFetch((url, init) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === `/api/questions/${question.key}`) return json(question)
      if (
        url === `/api/questions/${question.key}/answer` &&
        init?.method === 'POST'
      ) {
        return json(
          {
            code: 'ANSWER_ALREADY_SUBMITTED',
            message: 'Your first answer is already locked.',
          },
          409,
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp(`/q/${question.key}`)

    await user.type(
      await screen.findByRole('spinbutton', { name: 'Your answer' }),
      '11',
    )
    await user.click(screen.getByRole('button', { name: 'Lock in my answer' }))

    expect(
      await screen.findByRole('button', { name: 'See your locked answer' }),
    ).toBeInTheDocument()
  })

  it('fetches a direct result once and keeps the page as a snapshot', async () => {
    let resultRequests = 0
    installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === `/api/questions/${question.key}/results`) {
        resultRequests += 1
        return json(unlockedResult)
      }
      if (
        url ===
        '/api/questions/previous-unanswered?before=2026-07-28'
      ) {
        return json(null, 204)
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp(`/q/${question.key}/results`)

    expect(await screen.findByText('The crowd average')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(resultRequests).toBe(1)
  })

  it('shows a retryable preparation state when today is not ready', async () => {
    installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/today') {
        return json(
          {
            code: 'DAILY_QUESTION_PENDING',
            message: 'Today’s question is still being prepared.',
          },
          503,
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp('/')

    expect(
      await screen.findByRole('heading', {
        name: 'Today’s question is still under the tape.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })

  it('navigates to the nearest older unanswered question', async () => {
    const olderQuestion: PublicQuestion = {
      ...question,
      key: 'daily-2026-07-27',
      dayKey: '2026-07-27',
      prompt: 'How many different dogs have you petted?',
      unit: 'dogs',
    }
    installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === `/api/questions/${question.key}/results`) {
        return json(unlockedResult)
      }
      if (
        url ===
        '/api/questions/previous-unanswered?before=2026-07-28'
      ) {
        return json(olderQuestion)
      }
      if (url === `/api/questions/${olderQuestion.key}`) {
        return json(olderQuestion)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp(`/q/${question.key}/results`)

    await user.click(
      await screen.findByRole('button', {
        name: 'Answer an earlier question',
      }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: olderQuestion.prompt }),
      ).toBeInTheDocument()
    })
  })
})

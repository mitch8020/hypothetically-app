import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { PublicQuestion, QuestionResult } from './types'

const question: PublicQuestion = {
  key: 'doors-opened',
  prompt: 'How many doors do you think you’ve opened in your lifetime?',
  unit: 'doors',
  minimum: 0,
  maximum: 1_000_000_000,
  step: 1,
  precision: 0,
}

const result: QuestionResult = {
  question,
  average: 43.3333333333,
  answerCount: 3,
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
  computedAt: '2026-07-27T12:00:00.000Z',
}

type FetchHandler = (url: string, init?: RequestInit) => Response

function json(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  )
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
})

describe('How Many, Though? experience', () => {
  it('shows the preserved question and Google sign-in prompt to guests', async () => {
    installFetch((url) => {
      if (url === '/api/auth/me') return json({ user: null })
      if (url === '/api/questions/doors-opened') return json(question)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp('/q/doors-opened')

    expect(
      await screen.findByRole('heading', { name: question.prompt }),
    ).toBeInTheDocument()
    expect(screen.getByText('Got an answer?')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Sign in with Google' }),
    ).toHaveAttribute(
      'href',
      '/api/auth/google?returnTo=%2Fq%2Fdoors-opened',
    )
  })

  it('keeps the question visible after a failed Google callback', async () => {
    installFetch((url) => {
      if (url === '/api/auth/me') return json({ user: null })
      if (url === '/api/questions/doors-opened') return json(question)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp('/q/doors-opened?auth=failed')

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Google sign-in didn’t finish')
    expect(
      screen.getByRole('heading', { name: question.prompt }),
    ).toBeInTheDocument()
  })

  it('enforces question precision before sending an answer', async () => {
    const fetchMock = installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/doors-opened') return json(question)
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp('/q/doors-opened')

    const input = await screen.findByRole('spinbutton', {
      name: 'Your answer',
    })
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '1000000000')
    expect(input).toHaveAttribute('step', '1')
    await user.type(input, '2.5')
    await user.click(screen.getByRole('button', { name: 'Lock in my answer' }))

    expect(
      await screen.findByText('This one needs a whole number.'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url]) => String(url) === '/api/questions/doors-opened/answer',
      ),
    ).toBe(false)
  })

  it('submits once and reveals the crowd snapshot and leaderboard', async () => {
    installFetch((url, init) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/doors-opened') return json(question)
      if (
        url === '/api/questions/doors-opened/answer' &&
        init?.method === 'POST'
      ) {
        expect(JSON.parse(String(init.body))).toEqual({ value: 10 })
        return json(result, 201)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp('/q/doors-opened')

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
      screen.getByRole('button', { name: 'Answer Another Question' }),
    ).toBeInTheDocument()
  })

  it('offers the locked result when a different second answer conflicts', async () => {
    installFetch((url, init) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/doors-opened') return json(question)
      if (
        url === '/api/questions/doors-opened/answer' &&
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
    renderApp('/q/doors-opened')

    await user.type(
      await screen.findByRole('spinbutton', { name: 'Your answer' }),
      '11',
    )
    await user.click(screen.getByRole('button', { name: 'Lock in my answer' }))

    expect(
      await screen.findByRole('button', { name: 'See your locked answer' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Your first answer is already locked.'),
    ).toBeInTheDocument()
  })

  it('fetches a direct result once and keeps the page as a snapshot', async () => {
    let resultRequests = 0
    installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/doors-opened/results') {
        resultRequests += 1
        return json(result)
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp('/q/doors-opened/results')

    expect(await screen.findByText('The crowd average')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(resultRequests).toBe(1)
  })

  it('shows the completed-deck state when no questions remain', async () => {
    installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/random') return json(null, 204)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp('/')

    expect(
      await screen.findByRole('heading', {
        name: 'You answered the whole deck.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('24/24')).toBeInTheDocument()
  })

  it('draws a different question after the result call to action', async () => {
    const nextQuestion = {
      ...question,
      key: 'dogs-petted',
      prompt: 'How many different dogs have you petted?',
      unit: 'dogs',
    }
    installFetch((url) => {
      if (url === '/api/auth/me') return json(currentUser())
      if (url === '/api/questions/doors-opened/results') return json(result)
      if (url === '/api/questions/random?exclude=doors-opened') {
        return json(nextQuestion)
      }
      if (url === '/api/questions/dogs-petted') return json(nextQuestion)
      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()
    renderApp('/q/doors-opened/results')

    await user.click(
      await screen.findByRole('button', {
        name: 'Answer Another Question',
      }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: nextQuestion.prompt }),
      ).toBeInTheDocument()
    })
  })
})

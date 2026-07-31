import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveRoute } from './ArchiveRoute'
import type { ArchiveQuestion } from '../types'

const answeredQuestion: ArchiveQuestion = {
  key: 'daily-2026-07-30',
  prompt: 'How many paper clips could you line up across a basketball court?',
  unit: 'paper clips',
  minimum: 0,
  maximum: 1_000_000,
  step: 1,
  precision: 0,
  dayKey: '2026-07-30',
  topic: 'sports',
  answered: true,
}

const unansweredQuestion: ArchiveQuestion = {
  ...answeredQuestion,
  key: 'choosing-what-to-watch',
  prompt: 'How many total minutes have you spent deciding what to watch?',
  unit: 'minutes',
  dayKey: undefined,
  topic: 'everyday',
  answered: false,
}

const fullDeck = {
  questions: [answeredQuestion, unansweredQuestion],
  total: 2,
}

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderArchive(initialEntry = '/archive') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ArchiveRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function installFetch({
  user = { firstName: 'Alex', lastInitial: 'A', displayName: 'Alex A.' },
  archiveStatus = 'ok',
}: {
  user?: { firstName: string; lastInitial: string; displayName: string } | null
  archiveStatus?: 'ok' | 'forbidden' | 'failure'
} = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      return Promise.resolve(response({ user }))
    }
    if (url.startsWith('/api/questions/archive')) {
      if (archiveStatus === 'forbidden') {
        return Promise.resolve(
          response(
            { code: 'AUTH_REQUIRED', message: 'Sign in first.' },
            403,
          ),
        )
      }
      if (archiveStatus === 'failure') {
        return Promise.resolve(response({ message: 'broken deck' }, 500))
      }
      const params = new URL(url, 'http://localhost').searchParams
      if (params.get('status') === 'unanswered') {
        return Promise.resolve(response({ questions: [], total: 0 }))
      }
      if (params.get('status') === 'answered' || params.get('topic') === 'sports') {
        return Promise.resolve(
          response({ questions: [answeredQuestion], total: 1 }),
        )
      }
      return Promise.resolve(response(fullDeck))
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ArchiveRoute', () => {
  it('shows the Google sign-in gate for guests', async () => {
    installFetch({ user: null })
    renderArchive()

    expect(
      await screen.findByRole('heading', {
        name: 'Keep your place in the deck.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/api/auth/google?returnTo=%2Farchive',
    )
    expect(
      screen.getByRole('link', { name: 'Back to today’s question' }),
    ).toHaveAttribute('href', '/')
  })

  it('renders cards and refines them with status and topic filters', async () => {
    const user = userEvent.setup()
    installFetch()
    renderArchive('/archive?status=invalid&topic=invalid')

    expect(
      await screen.findByRole('heading', { name: 'Pick up an old thread.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('2 questions')).toBeInTheDocument()
    expect(screen.getAllByText('Sports & movement')).toHaveLength(2)
    expect(screen.getByText('Original deck')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See your result' })).toHaveAttribute(
      'href',
      '/q/daily-2026-07-30/results',
    )
    expect(screen.getByRole('link', { name: 'Answer question' })).toHaveAttribute(
      'href',
      '/q/choosing-what-to-watch',
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), 'sports')
    expect(await screen.findByText('1 question')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Answer question' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Already answered' }))
    expect(await screen.findAllByText('Already answered')).toHaveLength(2)
    expect(screen.getByText('1 question')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), 'all')
    expect(await screen.findByText('1 question')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Still to answer' }))
    expect(
      await screen.findByRole('heading', { name: 'No cards match those filters.' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show the full deck' }))
    expect(await screen.findByText('2 questions')).toBeInTheDocument()
  })

  it('shows retryable authentication and archive failures', async () => {
    let authAttempts = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        authAttempts += 1
        return Promise.resolve(
          authAttempts < 3
            ? response({ message: 'temporarily unavailable' }, 503)
            : response({ user: null }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderArchive()
    expect(
      await screen.findByRole(
        'heading',
        { name: 'The archive is out of reach.' },
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { name: 'Keep your place in the deck.' }),
    ).toBeInTheDocument()

    cleanup()
    installFetch({ archiveStatus: 'forbidden' })
    renderArchive()
    expect(
      await screen.findByRole('heading', { name: 'The cards got mixed up.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Sign in to open your personal question archive.'),
    ).toBeInTheDocument()

    cleanup()
    installFetch({ archiveStatus: 'failure' })
    renderArchive()
    expect(
      await screen.findByText('We couldn’t sort the deck right now. Try again in a moment.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByText('We couldn’t sort the deck right now. Try again in a moment.'),
    ).toBeInTheDocument()
  })

  it('shows loading while the archive request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    renderArchive()
    expect(
      screen.getByText(/Opening the question archive/),
    ).toBeInTheDocument()
  })
})

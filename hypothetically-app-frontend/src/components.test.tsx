import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnswerLine } from './components/AnswerLine'
import { AppShell } from './components/AppShell'
import { Avatar } from './components/Avatar'
import { BacklogCta } from './components/BacklogCta'
import { Leaderboard } from './components/Leaderboard'
import { LockedResult } from './components/LockedResult'
import { QuestionCard } from './components/QuestionCard'
import { ShareQuestion } from './components/ShareQuestion'
import { EmptyState, ErrorState, LoadingState, NotFoundRoute } from './routes/StateRoutes'
import type { PublicQuestion, QuestionResult } from './types'

const question: PublicQuestion = {
  key: 'daily-2026-07-28',
  prompt: 'How many doors?',
  unit: 'doors',
  minimum: 0,
  maximum: 100,
  step: 1,
  precision: 0,
  dayKey: '2026-07-28',
}

const locked: Extract<QuestionResult, { status: 'locked' }> = {
  status: 'locked',
  question,
  userAnswer: 42,
  unlocksAt: '2099-07-29T05:00:00.000Z',
  timeZone: 'America/Chicago',
}

function queryResult<T>(value: Partial<{ data: T; isPending: boolean }>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    ...value,
  } as never
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function withRouter(element: ReactNode, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('presentational components and states', () => {
  it('renders question card, avatars, and answer-line edge cases', () => {
    const { rerender } = render(<QuestionCard question={{ ...question, dayKey: undefined }} accented compact />)
    expect(screen.getByText('Just between us')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: question.prompt })).toBeInTheDocument()
    rerender(<QuestionCard question={question} />)
    expect(screen.getByText('Question of the day')).toBeInTheDocument()

    const avatar = render(<Avatar displayName="alex user" />)
    expect(avatar.container.querySelector('.avatar--fallback')).toHaveTextContent('A')
    avatar.rerender(<Avatar displayName="Alex User" avatarUrl="https://example.com/a.png" />)
    expect(avatar.container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.png')

    render(
      <AnswerLine
        average={10}
        unit="doors"
        entries={[
          { rank: 1, displayName: 'Alex A.', value: 10, distanceFromAverage: 0, isCurrentUser: true },
          { rank: 1, displayName: 'Alex A.', value: 10, distanceFromAverage: 0, isCurrentUser: true },
        ]}
      />,
    )
    expect(screen.getAllByTitle('Alex A.: 10 doors')).toHaveLength(1)
    expect(screen.getByText('crowd')).toBeInTheDocument()
  })

  it('renders leaderboard rows with and without a pinned user', () => {
    const leader = { rank: 1, displayName: 'Leader L.', value: 42, distanceFromAverage: 0, isCurrentUser: true }
    const user = { rank: 3, displayName: 'Alex A.', value: 99, distanceFromAverage: 57, isCurrentUser: true }
    const { rerender } = render(<Leaderboard leaders={[leader]} userEntry={leader} question={question} />)
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.queryByText('Your place')).not.toBeInTheDocument()
    rerender(<Leaderboard leaders={[{ ...leader, isCurrentUser: false }]} userEntry={user} question={question} />)
    expect(screen.getByText('Your place')).toBeInTheDocument()
    expect(screen.getByText('3', { selector: '.rank-token' })).toBeInTheDocument()
  })

  it('renders backlog waiting, pending, available, and complete states', () => {
    const navigate = vi.fn()
    withRouter(<BacklogCta query={queryResult({ isPending: true })} waiting />)
    expect(screen.getByText(/Checking the question drawer/)).toBeInTheDocument()
    cleanup()
    withRouter(<><BacklogCta query={queryResult({ data: question })} /><LocationProbe /></>)
    expect(screen.getByText(/another unanswered question/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Answer an earlier question' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/q/daily-2026-07-28')
    cleanup()
    withRouter(<BacklogCta query={queryResult({ data: null })} />)
    expect(screen.getByText(/caught up/)).toBeInTheDocument()
    cleanup()
    withRouter(<ErrorState title="Try again" message="Nope" onRetry={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(navigate).toHaveBeenCalledOnce()
    cleanup()
    withRouter(<ErrorState title="No route" message="Gone" />)
    expect(screen.getByRole('link', { name: 'Draw another question' })).toHaveAttribute('href', '/')
    cleanup()
    render(<LoadingState label="Counting" />)
    expect(screen.getByText(/Counting/)).toBeInTheDocument()
    cleanup()
    render(<EmptyState />)
    expect(screen.getByText('24/24')).toBeInTheDocument()
    cleanup()
    withRouter(<NotFoundRoute />)
    expect(screen.getByRole('heading', { name: /There.s no question here/ })).toBeInTheDocument()
  })

  it('renders the signed-in shell and navigates after logout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { firstName: 'Alex', lastInitial: 'A', displayName: 'Alex A.', avatarUrl: 'https://example.com/a.png' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Routes><Route element={<AppShell />} path="*"><Route index element={<p>home</p>} /></Route></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Alex')).toBeInTheDocument()
    expect(document.querySelector('.account img')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/auth/logout')).toBe(true)
  })

  it('covers share success, abort, copy fallback, and failure announcements', async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(true) })
    render(<ShareQuestion question={question} />)
    await user.click(screen.getByRole('button', { name: 'Share from this device' }))
    expect(await screen.findByText('Share sheet opened.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy question link' }))
    expect(await screen.findByText('Question link copied.')).toBeInTheDocument()

    share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    await user.click(screen.getByRole('button', { name: 'Share from this device' }))
    expect(screen.queryByText('The share sheet did not open. Copy the link instead.')).not.toBeInTheDocument()
    share.mockRejectedValueOnce(new Error('blocked'))
    await user.click(screen.getByRole('button', { name: 'Share from this device' }))
    expect(await screen.findByText('The share sheet did not open. Copy the link instead.')).toBeInTheDocument()

    vi.mocked(document.execCommand).mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Copy question link' }))
    expect(await screen.findByText('Copy did not work. Use one of the share links instead.')).toBeInTheDocument()
  })

  it('renders a locked result while checking and reports the check error', () => {
    withRouter(
      <LockedResult
        result={locked}
        checking
        checkError="not ready"
        onCheck={vi.fn()}
        backlogQuery={queryResult({ data: null })}
      />,
    )
    expect(screen.getByRole('button', { name: /Checking the crowd/ })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('not ready')
  })
})

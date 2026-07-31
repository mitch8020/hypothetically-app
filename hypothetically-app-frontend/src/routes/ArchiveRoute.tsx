import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { getArchive, getCurrentUser } from '../api'
import { GoogleMark } from '../components/GoogleMark'
import {
  QUESTION_TOPIC_VALUES,
  type ArchiveStatus,
  type QuestionTopic,
} from '../types'
import { ApiError } from '../api'
import { ErrorState, LoadingState } from './StateRoutes'

const TOPIC_LABELS: Record<QuestionTopic, string> = {
  food: 'Food & drink',
  sports: 'Sports & movement',
  home: 'Home & objects',
  everyday: 'Everyday life',
  creative: 'Creative & culture',
  nature: 'Nature & animals',
  other: 'Other',
}

const STATUS_OPTIONS: { value: ArchiveStatus; label: string }[] = [
  { value: 'all', label: 'All questions' },
  { value: 'unanswered', label: 'Still to answer' },
  { value: 'answered', label: 'Already answered' },
]

function isStatus(value: string | null): value is ArchiveStatus {
  return value === 'all' || value === 'answered' || value === 'unanswered'
}

function isTopic(value: string | null): value is QuestionTopic {
  return Boolean(
    value &&
      (QUESTION_TOPIC_VALUES as readonly string[]).includes(value),
  )
}

function questionDate(dayKey?: string): string {
  if (!dayKey) return 'Original deck'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dayKey}T12:00:00.000Z`))
}

export function ArchiveRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const topicParam = searchParams.get('topic')
  const status: ArchiveStatus = isStatus(statusParam) ? statusParam : 'all'
  const topic: QuestionTopic | 'all' = isTopic(topicParam)
    ? topicParam
    : 'all'
  const userQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
    retry: 1,
  })
  const archiveQuery = useQuery({
    queryKey: ['archive', status, topic],
    queryFn: () => getArchive(status, topic),
    enabled: Boolean(userQuery.data),
    retry: false,
  })

  function updateFilter(name: 'status' | 'topic', value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete(name)
    else next.set(name, value)
    setSearchParams(next)
  }

  if (userQuery.isPending || (userQuery.data && archiveQuery.isPending)) {
    return <LoadingState label="Opening the question archive" />
  }

  if (userQuery.isError) {
    return (
      <ErrorState
        title="The archive is out of reach."
        message="Refresh the page and we’ll check your sign-in again."
        onRetry={() => void userQuery.refetch()}
      />
    )
  }

  if (!userQuery.data) {
    return (
      <section className="archive-page archive-page--gate">
        <span className="archive-kicker">Your question archive</span>
        <h1>Keep your place in the deck.</h1>
        <p>
          Sign in to see what you’ve answered, what is still waiting, and which
          topic you should wander into next.
        </p>
        <a
          className="google-button"
          href={`/api/auth/google?returnTo=${encodeURIComponent('/archive')}`}
        >
          <GoogleMark />
          <span>Sign in with Google</span>
        </a>
        <Link className="archive-back-link" to="/">
          Back to today’s question
        </Link>
      </section>
    )
  }

  if (archiveQuery.isError || !archiveQuery.data) {
    const message =
      archiveQuery.error instanceof ApiError &&
      archiveQuery.error.status === 403
        ? 'Sign in to open your personal question archive.'
        : 'We couldn’t sort the deck right now. Try again in a moment.'
    return (
      <ErrorState
        title="The cards got mixed up."
        message={message}
        onRetry={() => void archiveQuery.refetch()}
      />
    )
  }

  const questions = archiveQuery.data.questions

  return (
    <section className="archive-page">
      <header className="archive-header">
        <div>
          <span className="archive-kicker">The question archive</span>
          <h1>Pick up an old thread.</h1>
          <p>
            Every question is a doorway back into the crowd. Filter the deck,
            then make your next guess.
          </p>
        </div>
        <Link className="archive-header__back" to="/">
          Today’s question <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <div className="archive-controls" aria-label="Archive filters">
        <fieldset className="archive-filter archive-filter--status">
          <legend>Show me</legend>
          <div className="archive-filter__options">
            {STATUS_OPTIONS.map((option) => (
              <label key={option.value} className="archive-choice">
                <input
                  type="radio"
                  name="archive-status"
                  value={option.value}
                  checked={status === option.value}
                  onChange={() => updateFilter('status', option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="archive-filter archive-filter--topic">
          <span>Topic</span>
          <select
            value={topic}
            onChange={(event) => updateFilter('topic', event.target.value)}
          >
            <option value="all">All topics</option>
            {QUESTION_TOPIC_VALUES.map((topicValue) => (
              <option key={topicValue} value={topicValue}>
                {TOPIC_LABELS[topicValue]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="archive-list-header">
        <span>{questions.length === 1 ? '1 question' : `${questions.length} questions`}</span>
        <span>{status === 'all' ? 'The full deck' : STATUS_OPTIONS.find((option) => option.value === status)?.label}</span>
      </div>

      {questions.length > 0 ? (
        <div className="archive-list">
          {questions.map((question) => (
            <article
              className={`archive-item${question.answered ? ' archive-item--answered' : ''}`}
              key={question.key}
            >
              <div className="archive-item__meta">
                <span>{question.answered ? 'Answered' : 'Not answered'}</span>
                <span>{questionDate(question.dayKey)}</span>
              </div>
              <div className="archive-item__body">
                <span className="archive-item__topic">
                  {TOPIC_LABELS[question.topic]}
                </span>
                <h2>{question.prompt}</h2>
                <p>Make a guess in {question.unit}.</p>
              </div>
              <Link
                className={question.answered ? 'secondary-button' : 'primary-button'}
                to={
                  question.answered
                    ? `/q/${question.key}/results`
                    : `/q/${question.key}`
                }
              >
                {question.answered ? 'See your result' : 'Answer question'}
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="archive-empty">
          <span className="archive-empty__mark" aria-hidden="true">∅</span>
          <h2>No cards match those filters.</h2>
          <p>Try a wider topic or switch back to the full deck.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setSearchParams({})}
          >
            Show the full deck
          </button>
        </div>
      )}
    </section>
  )
}

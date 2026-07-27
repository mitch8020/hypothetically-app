import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, getResult } from '../api'
import { AnswerLine } from '../components/AnswerLine'
import { Leaderboard } from '../components/Leaderboard'
import { QuestionCard } from '../components/QuestionCard'
import type { QuestionResult } from '../types'
import { ErrorState, LoadingState } from './StateRoutes'

interface ResultLocationState {
  result?: QuestionResult
  fromSubmission?: boolean
}

function formatAverage(result: QuestionResult): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: result.question.precision === 0 ? 1 : 0,
    maximumFractionDigits:
      result.question.precision === 0
        ? 1
        : Math.min(result.question.precision + 1, 2),
  }).format(result.average)
}

function formatGap(value: number, precision: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.min(precision + 1, 2),
  }).format(value)
}

export function ResultsRoute() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as ResultLocationState | null
  const submittedResult = locationState?.fromSubmission
    ? locationState.result
    : undefined
  const resultQuery = useQuery({
    queryKey: ['result-snapshot', key, location.key],
    queryFn: () => getResult(key),
    enabled: !submittedResult,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const result = submittedResult ?? resultQuery.data

  if (!result && resultQuery.isPending) {
    return <LoadingState label="Finding your place in the crowd" />
  }
  if (!result) {
    const needsAnswer =
      resultQuery.error instanceof ApiError &&
      (resultQuery.error.code === 'ANSWER_REQUIRED' ||
        resultQuery.error.status === 403)
    return (
      <ErrorState
        title={needsAnswer ? 'Your answer comes first.' : 'The numbers got crossed.'}
        message={
          needsAnswer
            ? 'Put your own guess on the board before seeing everyone else.'
            : 'We couldn’t rebuild this result snapshot.'
        }
        onRetry={
          needsAnswer
            ? () => navigate(`/q/${key}`)
            : () => void resultQuery.refetch()
        }
      />
    )
  }

  const answerLineEntries = result.userEntry.isCurrentUser
    ? [...result.leaders, result.userEntry]
    : result.leaders

  return (
    <section className="results-page">
      <div className="result-intro">
        <QuestionCard question={result.question} compact />
        <div className="average-board">
          <span>The crowd average</span>
          <strong>{formatAverage(result)}</strong>
          <small>{result.question.unit}</small>
          <p>
            {result.answerCount === 1
              ? 'You set the first marker. The crowd starts here.'
              : `Built from ${result.answerCount.toLocaleString()} locked answers.`}
          </p>
        </div>
      </div>

      <AnswerLine
        average={result.average}
        entries={answerLineEntries}
        unit={result.question.unit}
      />

      <div className="result-summary" aria-label="Your result">
        <span className="result-summary__rank">
          <small>Your place</small>
          <strong>#{result.userEntry.rank}</strong>
        </span>
        <span>
          <small>From the crowd</small>
          <strong>
            ±
            {formatGap(
              result.userEntry.distanceFromAverage,
              result.question.precision,
            )}
          </strong>
        </span>
        <span>
          <small>From the winner</small>
          <strong>
            ±
            {formatGap(
              result.userEntry.distanceToWinner,
              result.question.precision,
            )}
          </strong>
        </span>
      </div>

      <Leaderboard
        leaders={result.leaders}
        userEntry={result.userEntry}
        question={result.question}
      />

      <div className="results-cta">
        <p>Don’t overthink the next one.</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => navigate(`/?exclude=${result.question.key}`)}
        >
          Answer Another Question
        </button>
      </div>
    </section>
  )
}

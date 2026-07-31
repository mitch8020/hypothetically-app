import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useEffect, useState } from 'react'
import {
  ApiError,
  getRandomUnansweredQuestion,
  getResult,
} from '../api'
import { AnswerLine } from '../components/AnswerLine'
import { BacklogCta } from '../components/BacklogCta'
import { Leaderboard } from '../components/Leaderboard'
import { LockedResult } from '../components/LockedResult'
import { QuestionCard } from '../components/QuestionCard'
import { formatCompactNumber } from '../format'
import type { QuestionResult } from '../types'
import { ErrorState, LoadingState } from './StateRoutes'

interface ResultLocationState {
  result?: QuestionResult
  fromSubmission?: boolean
}

const MAX_TIMER_DELAY = 2_147_000_000

function formatGap(value: number, precision: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.min(precision + 1, 2),
  }).format(value)
}

export function ResultsRoute() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const locationState = location.state as ResultLocationState | null
  const initialResult = locationState?.fromSubmission
    ? locationState.result
    : undefined
  const [submittedResult, setSubmittedResult] = useState(initialResult)
  const resultQuery = useQuery({
    queryKey: ['question-result', key],
    queryFn: () => getResult(key),
    enabled: !submittedResult,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const refresh = useMutation({
    mutationFn: () => getResult(key),
    onSuccess: (result) => {
      setSubmittedResult(result)
      queryClient.setQueryData(['question-result', key], result)
    },
  })
  const { error: refreshError, isPending: checking, mutate: refreshResult } =
    refresh
  const result = submittedResult ?? resultQuery.data
  const backlogQuery = useQuery({
    queryKey: [
      'random-unanswered',
      key,
    ],
    queryFn: () => getRandomUnansweredQuestion(key),
    enabled: Boolean(result),
    staleTime: 30_000,
    retry: false,
  })

  useEffect(() => {
    if (result?.status !== 'locked' || checking || refreshError) return
    const remaining = new Date(result.unlocksAt).getTime() - Date.now()
    const timeout = window.setTimeout(
      () => refreshResult(),
      Math.min(MAX_TIMER_DELAY, Math.max(1_000, remaining + 250)),
    )
    return () => window.clearTimeout(timeout)
  }, [checking, refreshError, refreshResult, result])

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

  if (result.status === 'locked') {
    return (
      <LockedResult
        result={result}
        checking={checking}
        checkError={
          refreshError instanceof Error ? refreshError.message : undefined
        }
        onCheck={() => refreshResult()}
        backlogQuery={backlogQuery}
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
        <div className="median-board">
          <span>The crowd median</span>
          <strong>{formatCompactNumber(result.median)}</strong>
          <small>{result.question.unit}</small>
          <p>
            {result.answerCount === 1
              ? 'You set the first marker. The crowd starts here.'
              : `Built from ${formatCompactNumber(result.answerCount)} locked answers.`}
          </p>
        </div>
      </div>

      <AnswerLine
        median={result.median}
        entries={answerLineEntries}
        clusters={result.answerClusters}
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
              result.userEntry.distanceFromMedian,
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

      <BacklogCta query={backlogQuery} />
    </section>
  )
}

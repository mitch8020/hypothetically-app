import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ApiError,
  getCurrentUser,
  getQuestion,
  getResult,
  getTodayQuestion,
  submitAnswer,
} from '../api'
import { GoogleMark } from '../components/GoogleMark'
import { QuestionCard } from '../components/QuestionCard'
import type { PublicQuestion } from '../types'
import { ErrorState, LoadingState } from './StateRoutes'

function inputHint(question: PublicQuestion): string {
  const format = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: question.precision,
  })
  const precision =
    question.precision === 0 ? 'Use a whole number.' : 'One decimal is okay.'
  return `${precision} ${format.format(question.minimum)}–${format.format(question.maximum)} ${question.unit}.`
}

export function validateAnswer(
  question: PublicQuestion,
  rawValue: string,
): string | null {
  if (rawValue.trim() === '') {
    return 'Put a number on the board first.'
  }
  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    return 'Enter a real number.'
  }
  if (value < question.minimum || value > question.maximum) {
    return `Keep it between ${question.minimum.toLocaleString()} and ${question.maximum.toLocaleString()}.`
  }
  const steps = (value - question.minimum) / question.step
  if (Math.abs(steps - Math.round(steps)) > 1e-8) {
    return question.precision === 0
      ? 'This one needs a whole number.'
      : `Use increments of ${question.step}.`
  }
  return null
}

export function QuestionRoute() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [value, setValue] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const questionQuery = useQuery({
    queryKey: ['question', key],
    queryFn: () => (key === 'today' ? getTodayQuestion() : getQuestion(key)),
    retry: key === 'today' ? false : 1,
  })
  const userQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
    retry: 1,
  })
  const answerMutation = useMutation({
    mutationFn: (answer: number) => {
      if (!questionQuery.data) {
        throw new Error('The question is not ready yet.')
      }
      return submitAnswer(questionQuery.data.key, answer)
    },
    onSuccess: (result) => {
      navigate(`/q/${result.question.key}/results`, {
        state: { result, fromSubmission: true },
      })
    },
  })
  const question = questionQuery.data
  const shouldCheckTodayAnswer =
    key === 'today' && Boolean(userQuery.data && question)
  const todayResultQuery = useQuery({
    queryKey: ['question-result', question?.key],
    queryFn: () => {
      if (!question) {
        throw new Error('The question is not ready yet.')
      }
      return getResult(question.key)
    },
    enabled: shouldCheckTodayAnswer,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const serverError = useMemo(() => {
    if (!(answerMutation.error instanceof Error)) {
      return null
    }
    return answerMutation.error.message
  }, [answerMutation.error])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationMessage = validateAnswer(question!, value)
    setClientError(validationMessage)
    if (!validationMessage) {
      answerMutation.mutate(Number(value))
    }
  }

  if (
    questionQuery.isPending ||
    userQuery.isPending ||
    (shouldCheckTodayAnswer && todayResultQuery.isPending)
  ) {
    return <LoadingState />
  }
  if (questionQuery.isError || !question) {
    if (key === 'today') {
      return (
        <ErrorState
          title="Today’s question is still under the tape."
          message="It is being prepared now. Check again in a moment."
          onRetry={() => void questionQuery.refetch()}
        />
      )
    }
    return (
      <ErrorState
        title="That question wandered off."
        message="Draw a new one and keep guessing."
      />
    )
  }
  if (userQuery.isError) {
    return (
      <ErrorState
        title="We lost the sign-in signal."
        message="Refresh the page and we’ll check again."
        onRetry={() => void userQuery.refetch()}
      />
    )
  }

  const questionPath = key === 'today' ? '/q/today' : `/q/${question.key}`
  const conflict =
    answerMutation.error instanceof ApiError &&
    answerMutation.error.code === 'ANSWER_ALREADY_SUBMITTED'
  const alreadyAnswered = Boolean(todayResultQuery.data) || conflict

  return (
    <section className="question-page">
      <div className="question-stage">
        <div className="question-stage__index" aria-hidden="true">
          <span>There is no right answer.</span>
          <span>Only the crowd.</span>
        </div>
        <QuestionCard question={question} accented />
      </div>

      <div className="answer-panel">
        {!userQuery.data ? (
          <>
            {searchParams.get('auth') === 'failed' && (
              <div className="auth-failure" role="alert">
                Google sign-in didn’t finish. Your question is still here, so
                you can try again.
              </div>
            )}
            <span className="answer-panel__kicker">Got an answer?</span>
            <p>Keep it in your head. Sign in, lock it down, then meet the crowd.</p>
            <a
              className="google-button"
              href={`/api/auth/google?returnTo=${encodeURIComponent(questionPath)}`}
            >
              <GoogleMark />
              <span>Sign in with Google</span>
            </a>
            <small>We only keep your first name, last initial, and photo.</small>
          </>
        ) : alreadyAnswered ? (
          <>
            <span className="answer-panel__kicker">
              You’ve answered this question already.
            </span>
            <p>
              Your first answer is final. Head back to see where it landed with
              the crowd.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate(`/q/${question.key}/results`)}
            >
              See your result
            </button>
          </>
        ) : (
          <>
            <span className="answer-panel__kicker">
              Your move, {userQuery.data.firstName}
            </span>
            <p>Your first answer is final. Trust the number that showed up first.</p>
            <form className="answer-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="guess">Your answer</label>
              <div className="answer-board">
                <input
                  id="guess"
                  name="guess"
                  type="number"
                  inputMode={question.precision === 0 ? 'numeric' : 'decimal'}
                  min={question.minimum}
                  max={question.maximum}
                  step={question.step}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value)
                    setClientError(null)
                    answerMutation.reset()
                  }}
                  aria-describedby="guess-hint guess-error"
                  aria-invalid={Boolean(clientError || serverError)}
                  autoComplete="off"
                  autoFocus
                />
                <span>{question.unit}</span>
              </div>
              <span id="guess-hint" className="input-hint">
                {inputHint(question)}
              </span>
              <span id="guess-error" className="input-error" role="alert">
                {clientError || serverError}
              </span>
              <button
                className="primary-button"
                type="submit"
                disabled={answerMutation.isPending}
              >
                {answerMutation.isPending
                  ? 'Placing your answer…'
                  : 'Lock in my answer'}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  )
}

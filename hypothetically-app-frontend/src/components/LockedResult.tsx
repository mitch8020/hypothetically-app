import type { UseQueryResult } from '@tanstack/react-query'
import type { PublicQuestion, QuestionResult } from '../types'
import { BacklogCta } from './BacklogCta'
import { QuestionCard } from './QuestionCard'
import { ShareQuestion } from './ShareQuestion'

interface LockedResultProps {
  result: Extract<QuestionResult, { status: 'locked' }>
  checking: boolean
  checkError?: string
  onCheck: () => void
  backlogQuery: UseQueryResult<PublicQuestion | null>
}

function formatAnswer(value: number, precision: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: precision,
  }).format(value)
}

export function LockedResult({
  result,
  checking,
  checkError,
  onCheck,
  backlogQuery,
}: LockedResultProps) {
  const remainingSentence =
    result.remainingAnswerCount === 1
      ? '1 more answer arrives.'
      : `${result.remainingAnswerCount.toLocaleString()} more answers arrive.`

  return (
    <section className="locked-page">
      <QuestionCard question={result.question} compact />
      <div className="locked-layout">
        <section className="sealed-answer" aria-labelledby="sealed-title">
          <div className="sealed-answer__tape" aria-hidden="true">
            Crowd sealed
          </div>
          <span className="sealed-answer__kicker">Your answer is locked</span>
          <h1 id="sealed-title">
            {formatAnswer(result.userAnswer, result.question.precision)}
            <small>{result.question.unit}</small>
          </h1>
          <div
            className="crowd-ticket"
            aria-label={`${result.answerCount} out of ${result.requiredAnswerCount} answers in`}
          >
            <strong>
              {result.answerCount.toLocaleString()}
              <span aria-hidden="true"> / </span>
              <span className="visually-hidden"> out of </span>
              {result.requiredAnswerCount.toLocaleString()}
            </strong>
            <span>answers in</span>
          </div>
          <p>
            The average and leaderboard stay under the tape until{' '}
            {remainingSentence}
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? 'Checking the crowd…' : 'Check if it’s unlocked'}
          </button>
          <p className="input-error" role="alert">
            {checkError}
          </p>
        </section>
        <ShareQuestion question={result.question} />
      </div>
      <BacklogCta query={backlogQuery} waiting />
    </section>
  )
}

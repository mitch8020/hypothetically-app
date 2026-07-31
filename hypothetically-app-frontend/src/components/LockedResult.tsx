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

function formatUnlockTime(unlocksAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(unlocksAt))
}

export function LockedResult({
  result,
  checking,
  checkError,
  onCheck,
  backlogQuery,
}: LockedResultProps) {
  const unlockTime = formatUnlockTime(result.unlocksAt, result.timeZone)

  return (
    <section className="locked-page">
      <QuestionCard question={result.question} compact />
      <div className="locked-layout">
        <section className="sealed-answer" aria-labelledby="sealed-title">
          <div className="sealed-answer__tape" aria-hidden="true">
            Sealed until midnight
          </div>
          <span className="sealed-answer__kicker">Your answer is locked</span>
          <h1 id="sealed-title">
            {formatAnswer(result.userAnswer, result.question.precision)}
            <small>{result.question.unit}</small>
          </h1>
          <div
            className="crowd-ticket"
            aria-label={`Crowd results unlock at ${unlockTime}`}
          >
            <strong>Midnight</strong>
            <span>your time</span>
          </div>
          <p>
            The crowd median and leaderboard unlock at{' '}
            <br></br>
            <strong>{unlockTime}</strong>.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? 'Checking the crowd…' : 'Check now'}
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

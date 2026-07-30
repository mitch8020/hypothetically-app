import type { PublicQuestion } from '../types'

interface QuestionCardProps {
  question: PublicQuestion
  compact?: boolean
  accented?: boolean
}

export function QuestionCard({
  question,
  compact = false,
  accented = false,
}: QuestionCardProps) {
  return (
    <article className={`question-card${compact ? ' question-card--compact' : ''}`}>
      {accented && (
        <span className="question-card__accent" aria-hidden="true" />
      )}
      <span className="question-card__eyebrow">
        {question.dayKey ? 'Question of the day' : 'Just between us'}
      </span>
      <h1>{question.prompt}</h1>
      <span className="question-card__unit">Answer in {question.unit}</span>
      <span className="question-card__stamp" aria-hidden="true">
        ?
      </span>
    </article>
  )
}

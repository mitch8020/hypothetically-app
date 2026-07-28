import type { PublicQuestion } from '../types'

interface QuestionCardProps {
  question: PublicQuestion
  compact?: boolean
}

export function QuestionCard({ question, compact = false }: QuestionCardProps) {
  return (
    <article className={`question-card${compact ? ' question-card--compact' : ''}`}>
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

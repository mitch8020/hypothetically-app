import type { UseQueryResult } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { PublicQuestion } from '../types'

interface BacklogCtaProps {
  query: UseQueryResult<PublicQuestion | null>
  waiting?: boolean
}

export function BacklogCta({ query, waiting = false }: BacklogCtaProps) {
  const navigate = useNavigate()

  return (
    <section className="backlog-card" aria-label="Previous question">
      <span>{waiting ? 'While you wait' : 'Still guessing?'}</span>
      {query.isPending ? (
        <p>Checking the question drawer…</p>
      ) : query.data ? (
        <>
          <p>There is another unanswered question waiting behind this one.</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => navigate(`/q/${query.data?.key}`)}
          >
            Answer an earlier question
          </button>
        </>
      ) : (
        <p>You are caught up. Come back tomorrow for a new question.</p>
      )}
    </section>
  )
}

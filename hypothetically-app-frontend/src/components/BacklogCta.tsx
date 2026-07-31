import type { UseQueryResult } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import type { PublicQuestion } from '../types'

interface BacklogCtaProps {
  query: UseQueryResult<PublicQuestion | null>
  waiting?: boolean
}

export function BacklogCta({ query, waiting = false }: BacklogCtaProps) {
  const navigate = useNavigate()

  return (
    <section className="backlog-card" aria-label="Question deck">
      <span>{waiting ? 'While you wait' : 'Still guessing?'}</span>
      {query.isPending ? (
        <>
          <p>Shuffling the unanswered deck...</p>
          <div className="backlog-actions">
            <button className="primary-button" type="button" disabled>
              Answer a random question
            </button>
            <Link className="secondary-button" to="/archive">
              See the archive
            </Link>
          </div>
        </>
      ) : query.data ? (
        <>
          <p>There is another unanswered question waiting for you!</p>
          <div className="backlog-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => navigate(`/q/${query.data!.key}`)}
            >
              Answer a random question
            </button>
            <Link className="secondary-button" to="/archive">
              See the archive
            </Link>
          </div>
        </>
      ) : (
        <>
          <p>You are caught up. Come back tomorrow for a new question.</p>
          <div className="backlog-actions">
            <button className="primary-button" type="button" disabled>
              Answer a random question
            </button>
            <Link className="secondary-button" to="/archive">
              See the archive
            </Link>
          </div>
        </>
      )}
    </section>
  )
}

import { Link } from 'react-router'

export function LoadingState({ label = 'Taking a quick count' }: { label?: string }) {
  return (
    <section className="state-page" aria-live="polite">
      <div className="shuffle-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}…</p>
    </section>
  )
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry?: () => void
}) {
  return (
    <section className="state-page state-page--error">
      <span className="state-kicker">That didn’t add up</span>
      <h1>{title}</h1>
      <p>{message}</p>
      {onRetry ? (
        <button className="primary-button" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : (
        <Link className="primary-button" to="/">
          Draw another question
        </Link>
      )}
    </section>
  )
}

export function EmptyState() {
  return (
    <section className="state-page state-page--complete">
      <span className="completion-badge" aria-hidden="true">
        24/24
      </span>
      <span className="state-kicker">Every guess is in</span>
      <h1>You answered the whole deck.</h1>
      <p>
        That’s a lot of confidence for questions nobody can actually know.
      </p>
    </section>
  )
}

export function NotFoundRoute() {
  return (
    <ErrorState
      title="There’s no question here."
      message="The deck may have moved since this link was made."
    />
  )
}

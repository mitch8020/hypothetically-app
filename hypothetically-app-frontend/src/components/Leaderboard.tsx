import { Avatar } from './Avatar'
import type { LeaderboardEntry, PublicQuestion } from '../types'

function formatValue(value: number, precision: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(precision, 1),
  }).format(value)
}

function LeaderRow({
  entry,
  question,
  pinned = false,
}: {
  entry: LeaderboardEntry
  question: PublicQuestion
  pinned?: boolean
}) {
  return (
    <li className={`leader-row${entry.isCurrentUser ? ' leader-row--you' : ''}`}>
      <span className="rank-token">{entry.rank}</span>
      <Avatar displayName={entry.displayName} avatarUrl={entry.avatarUrl} />
      <span className="leader-name">
        <strong>{entry.isCurrentUser ? 'You' : entry.displayName}</strong>
        <small>
          {pinned ? 'Your place' : `#${entry.rank} from the crowd`}
        </small>
      </span>
      <span className="leader-value">
        <strong>{formatValue(entry.value, question.precision)}</strong>
        <small>{question.unit}</small>
      </span>
      <span className="leader-distance">
        <strong>±{formatValue(entry.distanceFromMedian, question.precision + 1)}</strong>
        <small>from median</small>
      </span>
    </li>
  )
}

export function Leaderboard({
  leaders,
  userEntry,
  question,
}: {
  leaders: LeaderboardEntry[]
  userEntry: LeaderboardEntry
  question: PublicQuestion
}) {
  const userIsLeader = leaders.some((entry) => entry.isCurrentUser)

  return (
    <section className="leaderboard" aria-labelledby="leaderboard-heading">
      <div className="section-heading">
        <span>Closest first</span>
        <h2 id="leaderboard-heading">The leaderboard</h2>
      </div>
      <ol>
        {leaders.map((entry, index) => (
          <LeaderRow
            entry={entry}
            question={question}
            key={`${entry.displayName}-${entry.value}-${index}`}
          />
        ))}
      </ol>
      {!userIsLeader && (
        <div className="pinned-result">
          <span>Your marker</span>
          <ol>
            <LeaderRow entry={userEntry} question={question} pinned />
          </ol>
        </div>
      )}
    </section>
  )
}

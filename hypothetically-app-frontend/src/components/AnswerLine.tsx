import type { CSSProperties } from 'react'
import type { LeaderboardEntry } from '../types'

interface AnswerLineProps {
  average: number
  entries: LeaderboardEntry[]
  unit: string
}

interface TokenStyle extends CSSProperties {
  '--token-x': string
  '--token-delay': string
}

export function AnswerLine({ average, entries, unit }: AnswerLineProps) {
  const uniqueEntries = entries.filter(
    (entry, index, allEntries) =>
      allEntries.findIndex(
        (candidate) =>
          candidate.displayName === entry.displayName &&
          candidate.value === entry.value,
      ) === index,
  )
  const points = [...uniqueEntries.map((entry) => entry.value), average]
  const minimum = Math.min(...points)
  const maximum = Math.max(...points)
  const range = maximum - minimum
  const position = (value: number) =>
    range === 0 ? 50 : 8 + ((value - minimum) / range) * 84

  return (
    <figure className="answer-line" aria-label={`Answers measured in ${unit}`}>
      <figcaption>
        <span>Low guess</span>
        <strong>Where the answers landed</strong>
        <span>High guess</span>
      </figcaption>
      <div className="answer-line__track">
        <span
          className="average-marker"
          style={{ left: `${position(average)}%` }}
        >
          <i />
          <b>crowd</b>
        </span>
        {uniqueEntries.map((entry, index) => (
          <span
            className={`answer-token${entry.isCurrentUser ? ' answer-token--you' : ''}`}
            key={`${entry.displayName}-${entry.value}`}
            style={
              {
                '--token-x': `${position(entry.value)}%`,
                '--token-delay': `${180 + index * 90}ms`,
              } as TokenStyle
            }
            title={`${entry.displayName}: ${entry.value.toLocaleString()} ${unit}`}
          >
            <i>{entry.rank}</i>
            <b>{entry.isCurrentUser ? 'you' : entry.displayName.split(' ')[0]}</b>
          </span>
        ))}
      </div>
    </figure>
  )
}

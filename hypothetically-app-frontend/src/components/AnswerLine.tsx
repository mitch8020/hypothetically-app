import type { CSSProperties } from 'react'
import { formatCompactNumber } from '../format'
import type { AnswerCluster, LeaderboardEntry } from '../types'

interface AnswerLineProps {
  median: number
  entries: LeaderboardEntry[]
  clusters?: AnswerCluster[]
  unit: string
}

interface ClusterStyle extends CSSProperties {
  '--cluster-start': string
  '--cluster-width': string
}

function fallbackClusters(entries: LeaderboardEntry[]): AnswerCluster[] {
  const counts = new Map<number, number>()
  for (const entry of entries) {
    counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([center, count]) => ({
      center,
      count,
      minimum: center,
      maximum: center,
    }))
}

function clusterLabel(cluster: AnswerCluster, unit: string): string {
  const count = Math.max(0, Math.floor(cluster.count))
  const answerWord = count === 1 ? 'answer' : 'answers'
  const minimum = formatCompactNumber(cluster.minimum)
  const maximum = formatCompactNumber(cluster.maximum)

  return cluster.minimum === cluster.maximum
    ? `${count} ${answerWord} at ${minimum} ${unit}`
    : `${count} ${answerWord} from ${minimum} to ${maximum} ${unit}`
}

export function AnswerLine({ median, entries, clusters, unit }: AnswerLineProps) {
  const answerClusters = clusters ?? fallbackClusters(entries)
  const clusterPoints = answerClusters.flatMap((cluster) => [
    cluster.minimum,
    cluster.maximum,
  ])
  const points = [...clusterPoints, median]
  const minimum = Math.min(...points)
  const maximum = Math.max(...points)
  const range = maximum - minimum
  const totalAnswers = answerClusters.reduce(
    (total, cluster) => total + Math.max(0, Math.floor(cluster.count)),
    0,
  )
  const position = (value: number) =>
    range === 0 ? 50 : 8 + ((value - minimum) / range) * 84

  return (
    <figure
      className="answer-line"
      aria-label={`Answer plot showing ${totalAnswers} ${totalAnswers === 1 ? 'answer' : 'answers'} measured in ${unit}`}
    >
      <figcaption>
        <span>Low guess</span>
        <strong>Answer plot</strong>
        <span>High guess</span>
      </figcaption>
      <div className="answer-line__track">
        {answerClusters.map((cluster, clusterIndex) => {
          const clusterMinimum = Math.min(cluster.minimum, cluster.maximum)
          const clusterMaximum = Math.max(cluster.minimum, cluster.maximum)
          const clusterStart = position(clusterMinimum)
          const clusterWidth = Math.max(
            0,
            position(clusterMaximum) - clusterStart,
          )
          const count = Math.max(0, Math.floor(cluster.count))
          const hasRange = clusterMinimum !== clusterMaximum

          return (
            <span
              className="answer-cluster"
              data-count={count}
              data-maximum={clusterMaximum}
              data-minimum={clusterMinimum}
              key={`${clusterMinimum}-${clusterMaximum}-${cluster.count}`}
              style={
                {
                  '--cluster-start': `${clusterStart}%`,
                  '--cluster-width': `${clusterWidth}%`,
                } as ClusterStyle
              }
              role="img"
              aria-label={clusterLabel(cluster, unit)}
            >
              <i className="answer-cluster__range" aria-hidden="true" />
              <i
                className="answer-dot answer-dot--minimum"
                style={{ '--dot-delay': `${180 + clusterIndex * 90}ms` } as CSSProperties}
                aria-hidden="true"
              />
              {hasRange && (
                <i
                  className="answer-dot answer-dot--maximum"
                  style={{ '--dot-delay': `${220 + clusterIndex * 90}ms` } as CSSProperties}
                  aria-hidden="true"
                />
              )}
            </span>
          )
        })}
        <span
          className="median-marker"
          style={{ left: `${position(median)}%` }}
          aria-label={`Median answer: ${formatCompactNumber(median)} ${unit}`}
        >
          <i aria-hidden="true" />
          <b>Median</b>
          <strong className="visually-hidden">
            {formatCompactNumber(median)}
          </strong>
        </span>
      </div>
    </figure>
  )
}

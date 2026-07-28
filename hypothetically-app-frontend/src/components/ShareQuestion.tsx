import { useMemo, useState } from 'react'
import type { PublicQuestion } from '../types'

interface ShareQuestionProps {
  question: PublicQuestion
}

function copyFallback(value: string): boolean {
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  return copied
}

export function ShareQuestion({ question }: ShareQuestionProps) {
  const [announcement, setAnnouncement] = useState('')
  const shareUrl = `${window.location.origin}/q/${encodeURIComponent(question.key)}`
  const shareText = `${question.prompt} Lock in your answer to help reveal the crowd.`
  const encodedUrl = encodeURIComponent(shareUrl)
  const encodedText = encodeURIComponent(shareText)
  const targets = useMemo(
    () => [
      {
        name: 'X',
        href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      },
      {
        name: 'Facebook',
        href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      },
      {
        name: 'LinkedIn',
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      },
    ],
    [encodedText, encodedUrl],
  )

  async function shareFromDevice() {
    try {
      await navigator.share({
        title: 'How Many, Though?',
        text: shareText,
        url: shareUrl,
      })
      setAnnouncement('Share sheet opened.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setAnnouncement('The share sheet did not open. Copy the link instead.')
    }
  }

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      } else if (!copyFallback(shareUrl)) {
        throw new Error('Copy was unavailable.')
      }
      setAnnouncement('Question link copied.')
    } catch {
      setAnnouncement('Copy did not work. Use one of the share links instead.')
    }
  }

  return (
    <section className="share-card" aria-labelledby="share-question-title">
      <span className="share-card__stamp" aria-hidden="true">
        Pass it on
      </span>
      <h2 id="share-question-title">Bring a few more guesses in.</h2>
      <p>
        Share this question with friends. Their answers move the crowd closer
        to the reveal.
      </p>
      <div className="share-actions">
        {typeof navigator.share === 'function' && (
          <button
            className="primary-button"
            type="button"
            onClick={() => void shareFromDevice()}
          >
            Share from this device
          </button>
        )}
        <button
          className="secondary-button"
          type="button"
          onClick={() => void copyLink()}
        >
          Copy question link
        </button>
      </div>
      <div className="share-feeds" aria-label="Share to a social feed">
        {targets.map((target) => (
          <a
            key={target.name}
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {target.name}
          </a>
        ))}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}

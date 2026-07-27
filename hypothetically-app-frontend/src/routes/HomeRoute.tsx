import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { getRandomQuestion } from '../api'
import { EmptyState, ErrorState, LoadingState } from './StateRoutes'

export function HomeRoute() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const exclude = searchParams.get('exclude') ?? undefined
  const questionQuery = useQuery({
    queryKey: ['random-question', exclude ?? 'none'],
    queryFn: () => getRandomQuestion(exclude),
    staleTime: 0,
    retry: 1,
  })

  useEffect(() => {
    if (questionQuery.data) {
      navigate(`/q/${questionQuery.data.key}`, { replace: true })
    }
  }, [navigate, questionQuery.data])

  if (questionQuery.isError) {
    return (
      <ErrorState
        title="The question deck slipped."
        message="We couldn’t pull a new question. Try the deck again."
        onRetry={() => void questionQuery.refetch()}
      />
    )
  }
  if (!questionQuery.isPending && questionQuery.data === null) {
    return <EmptyState />
  }
  return <LoadingState label="Shuffling the question deck" />
}

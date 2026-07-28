import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { getTodayQuestion } from '../api'
import { ErrorState, LoadingState } from './StateRoutes'

export function HomeRoute() {
  const navigate = useNavigate()
  const questionQuery = useQuery({
    queryKey: ['today-question'],
    queryFn: getTodayQuestion,
    staleTime: 0,
    retry: false,
  })

  useEffect(() => {
    if (questionQuery.data) {
      navigate(`/q/${questionQuery.data.key}`, { replace: true })
    }
  }, [navigate, questionQuery.data])

  if (questionQuery.isError) {
    return (
      <ErrorState
        title="Today’s question is still under the tape."
        message="It is being prepared now. Check again in a moment."
        onRetry={() => void questionQuery.refetch()}
      />
    )
  }
  return <LoadingState label="Preparing today’s question" />
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from 'react-router'
import { getCurrentUser, recordVisit, signOut } from '../api'
import { Avatar } from './Avatar'

export function AppShell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const userQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
    retry: 1,
  })
  useQuery({
    queryKey: ['daily-visit'],
    queryFn: async () => {
      await recordVisit()
      return true
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      queryClient.setQueryData(['current-user'], null)
      await queryClient.invalidateQueries({ queryKey: ['today-question'] })
      navigate('/')
    },
  })

  return (
    <div className="app-shell">
      <div className="paper-shape paper-shape--one" aria-hidden="true" />
      <div className="paper-shape paper-shape--two" aria-hidden="true" />
      <header className="site-header">
        <Link className="wordmark" to="/" aria-label="How Many, Though? home">
          <span>How many,</span>
          <strong>though?</strong>
        </Link>
        <div className="header-note" aria-hidden="true">
          <span>1 new question</span>
          <span>Every day</span>
        </div>
        {userQuery.data ? (
          <div className="account">
            <Avatar
              displayName={userQuery.data.displayName}
              avatarUrl={userQuery.data.avatarUrl}
            />
            <span>{userQuery.data.firstName}</span>
            <button
              className="text-button"
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sign out
            </button>
          </div>
        ) : (
          <span className="header-status">The crowd is thinking</span>
        )}
      </header>
      <main>
        <Outlet context={{ userQuery }} />
      </main>
      <footer>
        <span>Go with your gut.</span>
        <span>Then see where it lands.</span>
      </footer>
    </div>
  )
}

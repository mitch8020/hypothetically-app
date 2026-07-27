interface AvatarProps {
  displayName: string
  avatarUrl?: string
}

export function Avatar({ displayName, avatarUrl }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        className="avatar"
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
      />
    )
  }

  return (
    <span className="avatar avatar--fallback" aria-hidden="true">
      {displayName.charAt(0).toUpperCase()}
    </span>
  )
}

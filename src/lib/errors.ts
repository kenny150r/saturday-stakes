export function friendlyError(e: unknown, fallback = 'Something went wrong'): string {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e)
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (/abort/i.test(raw)) return fallback
  return raw || fallback
}

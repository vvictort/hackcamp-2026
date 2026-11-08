import { signOut } from 'deepspace'

/**
 * End this browser's session, then hard-navigate home. The server session is
 * revoked and the cached token cleared by the SDK; the full page load then
 * drops every in-memory record room, socket and query so nothing from the
 * previous account can linger. Safe to call when already signed out.
 */
export async function endSession(to = '/'): Promise<void> {
  try {
    await signOut()
  } catch {
    // The server may be unreachable; leaving anyway clears this tab's state.
  }
  window.location.assign(to)
}

/**
 * Token helpers for the routes (not room ops). Room ops are synchronous and
 * Workers hash only asynchronously, so the route creates the token, hashes it
 * here and passes only the hash to shareTokens.create / shareTokens.resolve.
 */

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** A new opaque link or session token (256 random bits, base64url). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 of the token, hex. Only this is stored (design doc: share tokens). */
export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

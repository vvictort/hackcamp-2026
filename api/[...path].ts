/**
 * Vercel catch-all proxy for the DeepSpace backend.
 *
 * The SPA calls same-origin `/api/*` (see src/lib/altamyra/api.ts). On Vercel
 * there is no Worker, so every `/api/*` request lands here and is forwarded to
 * the deployed DeepSpace app. Set ALTAmyra_BACKEND_ORIGIN in the Vercel
 * project settings to the URL `npx deepspace deploy` prints
 * (e.g. https://hackcamp-2026.app.space).
 *
 * Notes:
 * - Bearer auth and cookies pass through untouched.
 * - Live-timeline WebSockets do not survive this proxy; everything else does.
 * - Very large uploads are bounded by Vercel's request-size limits.
 */
export const config = { runtime: 'edge' }

export default async function proxy(req: Request): Promise<Response> {
  const origin = process.env.ALTAmyra_BACKEND_ORIGIN?.replace(/\/+$/, '')
  if (!origin) {
    return Response.json(
      { error: { code: 'bad_request', message: 'ALTAmyra_BACKEND_ORIGIN is not configured.' } },
      { status: 503 },
    )
  }
  const url = new URL(req.url)
  const upstream = new Request(`${origin}${url.pathname}${url.search}`, req)
  upstream.headers.delete('host')
  upstream.headers.delete('content-length')
  return fetch(upstream, { redirect: 'manual' })
}

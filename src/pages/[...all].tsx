import { Link } from 'react-router-dom'
import { APP_NAME } from '../constants'
import { buttonVariants } from '@/components/ui'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-6 text-center text-foreground sm:px-6">
      <title>{`Page not found · ${APP_NAME}`}</title>
      <meta name="robots" content="noindex" />
      <img src="/illustrations/not-found.svg" alt="" width={320} height={320} className="size-56 sm:size-64" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-display font-extrabold">We couldn&apos;t find that page</h1>
        <p className="max-w-[60ch] text-body-lg text-muted-foreground">
          Error 404. The link may be old or mistyped. Head back to your dashboard to keep going.
        </p>
      </div>
      <Link to="/home" className={buttonVariants({ size: 'lg' })}>
        Go to your dashboard
      </Link>
    </main>
  )
}

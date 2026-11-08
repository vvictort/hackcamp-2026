import { Link } from 'react-router'
import { APP_NAME } from '../constants'
import { buttonVariants } from '@/components/ui'
import { useLang } from '@/i18n'

export default function NotFound() {
  const { t } = useLang()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-6 text-center text-foreground sm:px-6">
      <title>{t('app.notFound.pageTitle', { appName: APP_NAME })}</title>
      <meta name="robots" content="noindex" />
      <img src="/illustrations/not-found.svg" alt="" width={320} height={320} className="size-56 sm:size-64" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-display font-extrabold">{t('app.notFound.title')}</h1>
        <p className="max-w-[60ch] text-body-lg text-muted-foreground">
          {t('app.notFound.body')}
        </p>
      </div>
      <Link to="/home" className={buttonVariants({ size: 'lg' })}>
        {t('app.notFound.cta')}
      </Link>
    </main>
  )
}

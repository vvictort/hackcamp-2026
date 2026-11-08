import type { ComponentProps } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from './Input'

interface SearchInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  onClear?: () => void
}

export function SearchInput({ className, onClear, value, ...props }: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      {/* Suppress the native WebKit cancel button — this component ships its
          own clear button below; without this, Chrome/Safari show both. */}
      <Input
        type="search"
        value={value}
        className={cn('pl-10 pr-11 [&::-webkit-search-cancel-button]:appearance-none', className)}
        {...props}
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-0 top-0 inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-5" aria-hidden />
        </button>
      )}
    </div>
  )
}

import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge must know the custom type scale in styles.css (text-display,
 * text-h1 ... text-small). Unknown `text-*` classes are treated as colors, so
 * without this `cn('text-small', 'text-primary-foreground')` drops one of them.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { borderRadius: ['panel'] },
    classGroups: {
      'font-size': [
        { text: ['mega', 'hero', 'hero-sm', 'display', 'display-sm', 'h1', 'h2', 'h3', 'body-lg', 'body', 'label', 'small'] },
      ],
      // Without this, shadow-raised/lift/ink read as shadow colours and never replace shadow-none etc.
      shadow: [{ shadow: ['raised', 'lift', 'ink'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** The first letter of a user's name, else of their email, else "?". */
export function initialOf(u?: { name?: string | null; email?: string | null } | null): string {
  return (u?.name?.trim() || u?.email?.trim() || '?')[0].toUpperCase()
}

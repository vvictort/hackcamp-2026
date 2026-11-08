import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge must know the custom type scale in styles.css (text-display,
 * text-h1 ... text-small). Unknown `text-*` classes are treated as colors, so
 * without this `cn('text-small', 'text-primary-foreground')` drops one of them.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['hero', 'display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'label', 'small'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

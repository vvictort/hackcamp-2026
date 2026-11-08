/**
 * UI primitives — correct-by-default, built on Base UI (@base-ui/react) and
 * styled entirely with the app's semantic theme tokens. These are yours:
 * restyle or delete them freely. Build app-specific components alongside them.
 *
 * The look comes from the token values in `styles.css`
 * (colors, radii, shadows) — change those to change the app, without
 * touching these files.
 *
 * @example
 * import { Button, Dialog, Select, useToast } from '../components/ui'
 */

/* Utility */
export { cn } from '@/lib/utils'

/* Form */
export { Button, buttonVariants, Spinner, type ButtonProps } from './Button'
export { Input, PasswordInput } from './Input'
export { FormField, type FormFieldControlProps } from './FormField'
export { Textarea } from './Textarea'
export { SearchInput } from './SearchInput'
export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectLabel, SelectItem, SelectSeparator,
} from './Select'
export { Label } from './Label'

/* Data display */
export { Badge, type BadgeProps } from './Badge'
export { StatusBadge, type StatusBadgeProps, type StatusTone } from './StatusBadge'
export { Avatar, AvatarImage, AvatarFallback } from './Avatar'
export { EmptyState } from './EmptyState'
export { Card } from './Card'
export { PageHeader } from './PageHeader'
export { Progress } from './Progress'

/* Feedback */
export { ToastProvider, useToast } from './Toast'

/* Overlay — `Modal` for simple controlled dialogs; the `Dialog` family for
 * triggers, nesting, and custom composition. */
export {
  Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from './Dialog'
export { Modal, ConfirmModal } from './Modal'
export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuGroup,
  DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuRadioGroup,
} from './DropdownMenu'
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './Tooltip'

import React from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'
import type { ToastState } from './hooks/useToast'

const typeStyles: Record<ToastState['type'], string> = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300',
  error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300',
  warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300',
  info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
}

const typeIcons: Record<ToastState['type'], React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 flex-shrink-0" />,
  error: <XCircle className="w-4 h-4 flex-shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 flex-shrink-0" />,
  info: <Info className="w-4 h-4 flex-shrink-0" />,
}

export default function Toast({ message, type, visible }: ToastState) {
  return (
    <div
      className={[
        'fixed bottom-4 right-4 z-[100]',
        'flex items-center gap-2',
        'max-w-xs px-4 py-3',
        'rounded-lg border shadow-lg',
        'text-sm font-medium',
        typeStyles[type],
        'transition-all duration-300 ease-in-out',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none',
      ].join(' ')}
      role="alert"
      aria-live="polite"
    >
      {typeIcons[type]}
      <span>{message}</span>
    </div>
  )
}

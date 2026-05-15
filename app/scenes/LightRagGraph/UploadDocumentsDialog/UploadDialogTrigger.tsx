import React from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import type { UploadDialogTriggerProps } from './UploadDocumentsDialog.types'

export function UploadDialogTrigger({ tooltipText, label }: UploadDialogTriggerProps) {
  const { t } = useTranslation()
  const resolvedTooltipText = tooltipText ?? t('Upload documents')
  const resolvedLabel = label ?? t('Upload')

  return (
    <button
      type="button"
      title={resolvedTooltipText}
      aria-label={resolvedTooltipText}
      className="inline-flex items-center gap-2 rounded-md bg-emerald-400 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      <Upload className="h-4 w-4" aria-hidden="true" />
      {resolvedLabel}
    </button>
  )
}

export default UploadDialogTrigger

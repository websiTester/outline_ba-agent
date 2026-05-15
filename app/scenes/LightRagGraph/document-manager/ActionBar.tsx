import React from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, CheckSquare, X } from 'lucide-react'
import { UploadDialogTrigger } from '../UploadDocumentsDialog/UploadDialogTrigger'

interface ActionBarProps {
  isSelectionMode: boolean
  isCurrentPageFullySelected: boolean
  selectedCount: number
  isDeleting?: boolean
  isClearing?: boolean
  hasPipelineBusyDoc?: boolean
  hasAnyDeleting?: boolean
  statusFilter?: string
  statusFilterCount?: number
  onUploadDocuments: () => void
  onClearDocuments: () => void
  onDeleteDocuments: () => void
  onSelectCurrentPage: () => void
  onDeselectAll: () => void
}

export default function ActionBar({
  isSelectionMode,
  isCurrentPageFullySelected,
  selectedCount,
  isDeleting = false,
  isClearing = false,
  hasPipelineBusyDoc = false,
  hasAnyDeleting = false,
  statusFilter = 'all',
  statusFilterCount = 0,
  onUploadDocuments,
  onClearDocuments,
  onDeleteDocuments,
  onSelectCurrentPage,
  onDeselectAll,
}: ActionBarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2 flex-wrap">

      {/* ── UPLOAD BUTTON — always visible ──────────────────────────────── */}
      <div onClick={onUploadDocuments}>
        <UploadDialogTrigger />
      </div>

      {isSelectionMode ? (
        <>
          {/* ── DELETE BUTTON ───────────────────────────────────────────── */}
          <button
            type="button"
            onClick={onDeleteDocuments}
            disabled={isDeleting || hasPipelineBusyDoc}
            title={
              hasPipelineBusyDoc
                ? t('Pipeline is busy. Wait until indexing finishes.')
                : undefined
            }
            className={[
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
              'border border-red-200 dark:border-red-700',
              'bg-white dark:bg-[#1f232e]',
              'text-red-600 dark:text-red-400',
              isDeleting || hasPipelineBusyDoc
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer',
              'focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2',
              'transition-colors',
            ].join(' ')}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting
              ? t('Deleting...')
              : t('Delete ({{count}})', { count: selectedCount })}
          </button>

          {/* ── SELECT / DESELECT BUTTON ─────────────────────────────────── */}
          <button
            type="button"
            onClick={isCurrentPageFullySelected ? onDeselectAll : onSelectCurrentPage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors cursor-pointer"
          >
            {isCurrentPageFullySelected ? (
              <><X className="w-3.5 h-3.5" />{t('Deselect All')}</>
            ) : (
              <><CheckSquare className="w-3.5 h-3.5" />{t('Select Page')}</>
            )}
          </button>
        </>
      ) : (
        /* ── CLEAR BUTTON ─────────────────────────────────────────────── */
        <button
          type="button"
          onClick={onClearDocuments}
          disabled={isClearing || hasPipelineBusyDoc || hasAnyDeleting}
          title={
            hasPipelineBusyDoc
              ? t('Pipeline is busy. Wait until indexing finishes.')
              : hasAnyDeleting
              ? t('Other deletions in progress.')
              : undefined
          }
          className={[
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
            'border border-gray-200 dark:border-[#2a2f3e]',
            'bg-white dark:bg-[#1f232e]',
            'text-gray-600 dark:text-[#E6E6E6]',
            isClearing || hasPipelineBusyDoc || hasAnyDeleting
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e] hover:border-gray-300 cursor-pointer',
            'transition-colors',
          ].join(' ')}
        >
          {isClearing
            ? t('Clearing...')
            : statusFilter === 'all'
            ? t('Clear')
            : t('Clear {{status}} ({{count}})', {
                status: statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1),
                count: statusFilterCount,
              })}
        </button>
      )}

    </div>
  )
}

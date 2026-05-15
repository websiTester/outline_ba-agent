import React from 'react'
import { useTranslation } from 'react-i18next'
import type { UploadDialogContentProps } from './UploadDocumentsDialog.types'
import { FileDropzone } from './FileDropzone'
import { MAX_FILE_SIZE, MAX_FILE_COUNT } from './upload-constants'

export function UploadDialogContent({
  title,
  description,
  maxFileCount = MAX_FILE_COUNT,
  maxSize = MAX_FILE_SIZE,
  fileTypesDescription = 'PDF, DOCX, TXT, MD, and more',
  fileErrors = {},
  fileStatuses = {},
  onUpload,
  onReject,
}: UploadDialogContentProps) {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('Upload Documents')
  const resolvedDescription = description ?? t('Drag and drop your files here or click to browse.')

  const handleUpload = (files: File[]) => { onUpload?.(files) }

  const handleReject = (rejectedFiles: File[]) => {
    const details = rejectedFiles.map((f) => ({
      fileName: f.name,
      errorMessage: `File rejected: ${f.name}`,
    }))
    onReject?.(details)
  }

  return (
    <div
      className="w-full max-w-xl rounded-lg bg-white p-6 shadow-lg dark:bg-[#111319]"
      role="dialog"
      aria-labelledby="upload-dialog-title"
      aria-describedby="upload-dialog-description"
    >
      <div className="mb-4 space-y-1.5">
        <h2
          id="upload-dialog-title"
          className="text-lg font-semibold leading-none tracking-tight text-gray-900 dark:text-[#E6E6E6]"
        >
          {resolvedTitle}
        </h2>
        <p id="upload-dialog-description" className="text-sm text-gray-500 dark:text-[#8a8f9e]">
          {resolvedDescription}
        </p>
      </div>
      <FileDropzone
        maxFileCount={maxFileCount}
        maxSize={maxSize}
        description={fileTypesDescription}
        fileErrors={fileErrors}
        fileStatuses={fileStatuses}
        onUpload={handleUpload}
        onReject={handleReject}
      />
    </div>
  )
}

export default UploadDialogContent

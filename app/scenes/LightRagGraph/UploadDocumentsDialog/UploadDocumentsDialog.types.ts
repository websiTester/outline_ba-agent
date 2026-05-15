export type FileErrors = Record<string, string>

export type FileUploadStatus = 'idle' | 'uploading' | 'success' | 'duplicate' | 'error'

export type FileStatuses = Record<string, FileUploadStatus>

export interface FileRejectionDetail {
  fileName: string
  errorMessage: string
}

export interface UploadDocumentsDialogProps {
  isOpen: boolean
  onClose: () => void
  /**
   * Called after at least one file has been successfully uploaded. The parent
   * uses this to refresh the document list and trigger fast-mode pipeline
   * polling. Implemented fully in M8 (sequential per-file upload).
   */
  onDocumentsUploaded?: (files: File[]) => void
}

export interface UploadDialogTriggerProps {
  tooltipText?: string
  label?: string
}

export interface UploadDialogContentProps {
  title: string
  description: string
  maxFileCount?: number
  maxSize?: number
  fileTypesDescription?: string
  fileErrors?: FileErrors
  fileStatuses?: FileStatuses
  onUpload?: (files: File[]) => void
  onReject?: (rejections: FileRejectionDetail[]) => void
}

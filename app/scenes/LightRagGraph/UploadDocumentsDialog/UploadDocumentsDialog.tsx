import { X } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadDocument } from "../lib/api";
import { UploadDialogContent } from "./UploadDialogContent";
import type {
  FileErrors,
  FileStatuses,
  UploadDocumentsDialogProps,
} from "./UploadDocumentsDialog.types";
import {
  MAX_FILE_COUNT,
  MAX_FILE_SIZE,
  getAllowedFileTypesDescription,
} from "./upload-constants";

export default function UploadDocumentsDialog({
  isOpen,
  onClose,
  onDocumentsUploaded,
}: UploadDocumentsDialogProps) {
  const { t } = useTranslation();
  const [fileErrors, setFileErrors] = useState<FileErrors>({});
  const [fileStatuses, setFileStatuses] = useState<FileStatuses>({});
  const [isUploading, setIsUploading] = useState(false);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't close while upload is in progress — would lose status display
    if (e.target === e.currentTarget && !isUploading) {
      onClose();
    }
  };

  const handleClose = useCallback(() => {
    if (isUploading) {
      return;
    }
    // Reset state when dialog actually closes
    setFileErrors({});
    setFileStatuses({});
    onClose();
  }, [isUploading, onClose]);

  /**
   * Sequential upload: process files one at a time so per-file progress is
   * visible and a single LLM rate-limit failure doesn't cascade. Continues
   * with remaining files even if one fails (status="error").
   *
   * Status transitions per file:
   *   idle → uploading → success | duplicate | error
   */
  const handleUpload = useCallback(
    async (incomingFiles: File[]) => {
      if (incomingFiles.length === 0) {
        return;
      }

      // Initialize all incoming files as "uploading" — visual feedback
      // before the first request resolves. Sequential loop will mutate
      // the eventual status of each.
      setFileStatuses((prev) => {
        const next: FileStatuses = { ...prev };
        for (const file of incomingFiles) {
          next[file.name] = "uploading";
        }
        return next;
      });
      setIsUploading(true);

      const successfulFiles: File[] = [];

      for (const file of incomingFiles) {
        try {
          const result = await uploadDocument(file);

          if (result.status === "success") {
            setFileStatuses((prev) => ({ ...prev, [file.name]: "success" }));
            successfulFiles.push(file);
          } else if (result.status === "duplicate") {
            setFileStatuses((prev) => ({ ...prev, [file.name]: "duplicate" }));
            setFileErrors((prev) => ({
              ...prev,
              [file.name]:
                result.message ||
                t("File already exists in the knowledge graph"),
            }));
          } else {
            // status === "error" — backend returned an error in the response body
            setFileStatuses((prev) => ({ ...prev, [file.name]: "error" }));
            setFileErrors((prev) => ({
              ...prev,
              [file.name]: result.message || t("Upload failed"),
            }));
          }
        } catch (err) {
          // Network failure, HTTP error, etc. — propagated by uploadDocument()
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : t("Upload failed");
          setFileStatuses((prev) => ({ ...prev, [file.name]: "error" }));
          setFileErrors((prev) => ({ ...prev, [file.name]: msg }));
        }
      }

      setIsUploading(false);

      // Notify parent so DocumentManager can refresh list + trigger fast polling
      if (successfulFiles.length > 0) {
        onDocumentsUploaded?.(successfulFiles);
      }
    },
    [onDocumentsUploaded, t]
  );

  const handleReject = useCallback(
    (rejections: { fileName: string; errorMessage: string }[]) => {
      rejections.forEach(({ fileName, errorMessage }) => {
        setFileErrors((prev) => ({ ...prev, [fileName]: errorMessage }));
        setFileStatuses((prev) => ({ ...prev, [fileName]: "error" }));
      });
    },
    []
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="presentation"
      aria-hidden="false"
    >
      <button
        type="button"
        onClick={handleClose}
        disabled={isUploading}
        className={`absolute right-4 top-4 rounded-sm p-1 text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
          isUploading ? "cursor-not-allowed opacity-50" : ""
        }`}
        aria-label="Close dialog"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <UploadDialogContent
        title={t("Upload Documents")}
        description={t("Drag and drop your files here or click to browse.")}
        maxFileCount={MAX_FILE_COUNT}
        maxSize={MAX_FILE_SIZE}
        fileTypesDescription={getAllowedFileTypesDescription()}
        fileErrors={fileErrors}
        fileStatuses={fileStatuses}
        onUpload={handleUpload}
        onReject={handleReject}
      />
    </div>
  );
}

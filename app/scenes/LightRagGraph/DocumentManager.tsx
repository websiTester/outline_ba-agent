import { observer } from "mobx-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import ActionBar from "./document-manager/ActionBar";
import ConfirmDialog from "./document-manager/ConfirmDialog";
import DocumentManagerSkeleton from "./document-manager/DocumentManagerSkeleton";
import DocumentTable from "./document-manager/DocumentTable";
import Pagination from "./document-manager/Pagination";
import StatusFilterBar from "./document-manager/StatusFilterBar";
import Toast from "./document-manager/Toast";
import { useToast } from "./document-manager/hooks/useToast";
import type {
  Document,
  DocumentManagerProps,
  SortDirection,
  SortField,
  StatusCounts,
  StatusFilter,
} from "./document-manager/types/document";
import {
  addDeletingIds,
  getDeletingIds,
  removeDeletingIds,
} from "./document-manager/utils/deleting-ids-storage";
import UploadDocumentsDialog from "./UploadDocumentsDialog/UploadDocumentsDialog";
import {
  apiClearDocuments,
  apiDeleteDocuments,
  apiFetchDocuments,
  apiFetchPipelineStatus,
  isWorkspaceLockError,
} from "./lib/api";

const PAGE_SIZE = 20;
const EMPTY_STATUS_COUNTS: StatusCounts = {
  all: 0,
  processed: 0,
  preprocessed: 0,
  processing: 0,
  pending: 0,
  failed: 0,
};

function DocumentManager({ isLoading = false }: DocumentManagerProps) {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const workspaceId = team.id;

  // ── UI State ──────────────────────────────────────────────────────────
  const [documents, setDocuments] = useState<Document[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>(EMPTY_STATUS_COUNTS);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(
    () => getDeletingIds(workspaceId)
  );
  const [showFileName, setShowFileName] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Operation flags
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isFetchingDocuments, setIsFetchingDocuments] = useState(false);
  const [isPipelineBusy, setIsPipelineBusy] = useState(false);

  // Dialog states
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const { toast, showToast } = useToast(3500);

  // ── Refs: hold latest values for callbacks called from polling/timeouts
  const currentPageRef = useRef(1);
  const statusFilterRef = useRef<StatusFilter>("all");
  const sortFieldRef = useRef<SortField>("updated_at");
  const sortDirectionRef = useRef<SortDirection>("desc");
  const searchQueryRef = useRef("");
  const workspaceIdRef = useRef(workspaceId);
  const pipelinePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerFastPollRef = useRef<(() => void) | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  currentPageRef.current = currentPage;
  statusFilterRef.current = statusFilter;
  sortFieldRef.current = sortField;
  sortDirectionRef.current = sortDirection;
  searchQueryRef.current = debouncedSearch;
  workspaceIdRef.current = workspaceId;

  // Debounce search → reset to page 1
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch]);

  // ── Computed values ───────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const isSelectionMode = selectedDocIds.length > 0;
  const hasAnyDeleting = deletingDocIds.size > 0;
  const currentPageDocIds = documents
    .filter((d) => !deletingDocIds.has(d.id))
    .map((d) => d.id);
  const isCurrentPageFullySelected =
    currentPageDocIds.length > 0 &&
    currentPageDocIds.every((id) => selectedDocIds.includes(id));

  // ── Data fetching ────────────────────────────────────────────────────
  const fetchDocuments = useCallback(async () => {
    const statusParam =
      statusFilterRef.current === "all" ? undefined : statusFilterRef.current;
    const searchParam = searchQueryRef.current.trim() || undefined;
    setIsFetchingDocuments(true);
    try {
      const result = await apiFetchDocuments(
        statusParam,
        currentPageRef.current,
        PAGE_SIZE,
        sortFieldRef.current,
        sortDirectionRef.current,
        searchParam
      );
      // Read deleting-ids AFTER the API resolves to avoid races with pollers.
      // Auto-cleanup: IDs no longer in backend response → remove from localStorage.
      const latestDeletingIds = getDeletingIds(workspaceIdRef.current);
      const resultDocIds = new Set(result.documents.map((d) => d.id));
      const gone = [...latestDeletingIds].filter((id) => !resultDocIds.has(id));
      if (gone.length > 0) {
        removeDeletingIds(workspaceIdRef.current, gone);
      }
      const activeDeletingIds = getDeletingIds(workspaceIdRef.current);
      const docs: Document[] = result.documents.map((doc) =>
        activeDeletingIds.has(doc.id) ? { ...doc, status: "deleting" } : doc
      );
      setDocuments(docs);
      setTotalCount(result.total);
      setDeletingDocIds(activeDeletingIds);
    } catch {
      // Keep stale data — don't crash the UI on transient failures
    } finally {
      setIsFetchingDocuments(false);
    }
  }, []);

  const fetchStatusCounts = useCallback(async () => {
    try {
      const [allR, processedR, preprocessedR, processingR, pendingR, failedR] =
        await Promise.all([
          apiFetchDocuments(undefined, 1, 1, "updated_at", "desc"),
          apiFetchDocuments("processed", 1, 1, "updated_at", "desc"),
          apiFetchDocuments("preprocessed", 1, 1, "updated_at", "desc"),
          apiFetchDocuments("processing", 1, 1, "updated_at", "desc"),
          apiFetchDocuments("pending", 1, 1, "updated_at", "desc"),
          apiFetchDocuments("failed", 1, 1, "updated_at", "desc"),
        ]);
      setStatusCounts({
        all: allR.total,
        processed: processedR.total,
        preprocessed: preprocessedR.total,
        processing: processingR.total,
        pending: pendingR.total,
        failed: failedR.total,
      });
    } catch {
      // Keep stale counts
    }
  }, []);

  // Auto-fetch on page/filter/sort/search change
  useEffect(() => {
    void fetchDocuments();
  }, [currentPage, statusFilter, sortField, sortDirection, debouncedSearch, fetchDocuments]);

  // Initial mount: fetch status counts
  useEffect(() => {
    void fetchStatusCounts();
  }, [fetchStatusCounts]);

  // ── Adaptive pipeline polling ─────────────────────────────────────────
  // busy=true  → poll every 2s (need quick UI updates during indexing)
  // busy=false → poll every 30s (idle — no urgency)
  useEffect(() => {
    const scheduleNext = (busy: boolean) => {
      const delay = busy ? 2000 : 30000;
      pipelinePollRef.current = setTimeout(poll, delay);
    };

    const poll = async () => {
      const data = await apiFetchPipelineStatus();
      setIsPipelineBusy(data.busy);
      // When pipeline goes from busy → idle, refresh the document list
      // so status badges update (pending → processed, etc.)
      scheduleNext(data.busy);
    };

    // Expose a trigger so upload/delete handlers can force fast-mode polling
    // immediately (don't wait for the current 30s idle timeout to elapse).
    triggerFastPollRef.current = () => {
      if (pipelinePollRef.current) {
        clearTimeout(pipelinePollRef.current);
        pipelinePollRef.current = null;
      }
      setIsPipelineBusy(true);
      pipelinePollRef.current = setTimeout(poll, 2000);
    };

    void poll(); // immediate first check
    return () => {
      if (pipelinePollRef.current) {
        clearTimeout(pipelinePollRef.current);
        pipelinePollRef.current = null;
      }
      triggerFastPollRef.current = null;
    };
  }, []);

  // Cleanup poll intervals on unmount
  useEffect(
    () => () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    },
    []
  );

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (status: StatusFilter) => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const handleDocumentSelect = (docId: string, checked: boolean) => {
    setSelectedDocIds((prev) =>
      checked ? [...prev, docId] : prev.filter((id) => id !== docId)
    );
  };

  // After upload: kick pipeline polling to fast mode + refresh list shortly after
  // (wait 1s so backend background task can write doc_status before we re-fetch)
  const handleDocumentsUploaded = useCallback(() => {
    triggerFastPollRef.current?.();
    setTimeout(() => {
      if (currentPageRef.current === 1) {
        void fetchDocuments();
      } else {
        setCurrentPage(1); // triggers useEffect → fetchDocuments
      }
      void fetchStatusCounts();
    }, 1000);
  }, [fetchDocuments, fetchStatusCounts]);

  // ── Polling: wait until deleted IDs disappear from backend ───────────
  const pollUntilDeleted = useCallback(
    (deletedDocIds: string[]) => {
      const deletedSet = new Set(deletedDocIds);
      const MAX_POLLS = 15;
      let pollCount = 0;

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      pollIntervalRef.current = setInterval(async () => {
        pollCount++;
        try {
          const statusParam =
            statusFilterRef.current === "all" ? undefined : statusFilterRef.current;
          const searchParam = searchQueryRef.current.trim() || undefined;
          const result = await apiFetchDocuments(
            statusParam,
            currentPageRef.current,
            PAGE_SIZE,
            sortFieldRef.current,
            sortDirectionRef.current,
            searchParam
          );
          const anyStillVisible = result.documents.some((d) =>
            deletedSet.has(d.id)
          );

          if (!anyStillVisible || pollCount >= MAX_POLLS) {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            removeDeletingIds(workspaceIdRef.current, Array.from(deletedSet));
            const remaining = getDeletingIds(workspaceIdRef.current);
            setDeletingDocIds(remaining);
            const finalDocs: Document[] = result.documents.map((doc) =>
              remaining.has(doc.id) ? { ...doc, status: "deleting" } : doc
            );
            setDocuments(finalDocs);
            setTotalCount(result.total);
            void fetchStatusCounts();
          } else {
            const currentDeletingIds = getDeletingIds(workspaceIdRef.current);
            setDocuments(
              result.documents.map((doc) =>
                currentDeletingIds.has(doc.id)
                  ? { ...doc, status: "deleting" }
                  : doc
              )
            );
            setTotalCount(result.total);
          }
        } catch {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          // Keep localStorage — TTL 10min will auto-expire
        }
      }, 2000);
    },
    [fetchStatusCounts]
  );

  // ── Delete handler ────────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(async () => {
    const docIdsToDelete = [...selectedDocIds];
    setIsDeleting(true);
    try {
      const result = await apiDeleteDocuments(docIdsToDelete, true);
      if (result.status === "busy") {
        showToast(
          t("Pipeline is busy. Please wait for indexing to finish."),
          "warning"
        );
        setIsDeleting(false);
        setShowDeleteDialog(false);
        return;
      }
      showToast(
        t("Deletion started for {{count}} document(s).", {
          count: result.doc_ids.length,
        }),
        "info"
      );
      addDeletingIds(workspaceIdRef.current, docIdsToDelete);
      setDeletingDocIds(getDeletingIds(workspaceIdRef.current));
    } catch (err) {
      if (isWorkspaceLockError(err)) {
        showToast(t("Workspace is locked by another operation."), "warning");
      } else {
        showToast(t("Delete request failed. Check your connection."), "error");
      }
      setIsDeleting(false);
      setShowDeleteDialog(false);
      return;
    }

    setSelectedDocIds([]);
    setShowDeleteDialog(false);
    setIsDeleting(false);
    await fetchDocuments();
    pollUntilDeleted(docIdsToDelete);
  }, [selectedDocIds, showToast, fetchDocuments, pollUntilDeleted, t]);

  // ── Clear handler ─────────────────────────────────────────────────────
  const handleClearConfirm = useCallback(async () => {
    setIsClearing(true);
    try {
      // Filter-aware clear: when a status filter is active, delete only
      // matching docs. Otherwise drop all storages (faster).
      if (statusFilterRef.current !== "all") {
        const filterStatus = statusFilterRef.current;
        const filterCount = statusCounts[filterStatus];
        const result = await apiFetchDocuments(
          filterStatus,
          1,
          Math.max(filterCount, 1000),
          "updated_at",
          "desc"
        );
        const docIdsToDelete = result.documents.map((d) => d.id);

        if (docIdsToDelete.length === 0) {
          showToast(
            t('No documents to clear for status "{{status}}".', {
              status: filterStatus,
            }),
            "info"
          );
          setIsClearing(false);
          setShowClearDialog(false);
          return;
        }

        const deleteResult = await apiDeleteDocuments(docIdsToDelete, true);
        if (deleteResult.status === "busy") {
          showToast(
            t("Pipeline is busy. Please wait for indexing to finish."),
            "warning"
          );
          setIsClearing(false);
          setShowClearDialog(false);
          return;
        }

        setDocuments((prev) =>
          prev.filter((doc) => !docIdsToDelete.includes(doc.id))
        );
        setSelectedDocIds([]);
        setShowClearDialog(false);
        showToast(
          t('Clearing {{count}} "{{status}}" document(s).', {
            count: docIdsToDelete.length,
            status: filterStatus,
          }),
          "success"
        );
        pollUntilDeleted(docIdsToDelete);
      } else {
        // Clear ALL — drop all storages on the backend
        const result = await apiClearDocuments();
        if (result.status === "busy") {
          showToast(
            t("Pipeline is busy. Please wait for indexing to finish."),
            "warning"
          );
          setIsClearing(false);
          setShowClearDialog(false);
          return;
        }

        setDocuments([]);
        setTotalCount(0);
        setStatusCounts(EMPTY_STATUS_COUNTS);
        setSelectedDocIds([]);
        setCurrentPage(1);
        setShowClearDialog(false);
        showToast(t("All documents cleared."), "success");
      }
    } catch (err) {
      if (isWorkspaceLockError(err)) {
        showToast(t("Workspace is locked by another operation."), "warning");
      } else {
        showToast(
          t("Clear failed. UI updated but backend may have errors."),
          "error"
        );
      }
      setDocuments([]);
      setSelectedDocIds([]);
      setShowClearDialog(false);
    } finally {
      setIsClearing(false);
    }
  }, [statusCounts, showToast, pollUntilDeleted, t]);

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading) {
    return <DocumentManagerSkeleton />;
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-0">
      <Toast {...toast} />

      {/* Action Bar */}
      <div className="mb-4">
        <ActionBar
          isSelectionMode={isSelectionMode}
          isCurrentPageFullySelected={isCurrentPageFullySelected}
          selectedCount={selectedDocIds.length}
          isDeleting={isDeleting}
          isClearing={isClearing}
          hasPipelineBusyDoc={isPipelineBusy}
          hasAnyDeleting={hasAnyDeleting}
          statusFilter={statusFilter}
          statusFilterCount={statusCounts[statusFilter]}
          onUploadDocuments={() => setShowUploadDialog(true)}
          onClearDocuments={() => setShowClearDialog(true)}
          onDeleteDocuments={() => setShowDeleteDialog(true)}
          onSelectCurrentPage={() => setSelectedDocIds(currentPageDocIds)}
          onDeselectAll={() => setSelectedDocIds([])}
        />
      </div>

      {/* Documents Section */}
      <div className="flex flex-col border border-gray-200 dark:border-[#2a2f3e] rounded-lg overflow-hidden">
        <StatusFilterBar
          statusFilter={statusFilter}
          statusCounts={statusCounts}
          showFileName={showFileName}
          searchQuery={searchQuery}
          onFilterChange={handleStatusFilterChange}
          onSearchChange={setSearchQuery}
          onRefresh={() => {
            void fetchDocuments();
            void fetchStatusCounts();
          }}
          onToggleFileName={() => setShowFileName(!showFileName)}
        />

        <div className="overflow-auto relative">
          {isFetchingDocuments && (
            <div className="absolute inset-0 bg-white/70 dark:bg-[#111319]/70 flex items-center justify-center z-20">
              <svg
                className="animate-spin h-7 w-7 text-emerald-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}
          <DocumentTable
            documents={documents}
            sortField={sortField}
            sortDirection={sortDirection}
            showFileName={showFileName}
            selectedDocIds={selectedDocIds}
            deletingDocIds={deletingDocIds}
            onSort={handleSort}
            onDocumentSelect={handleDocumentSelect}
          />
        </div>

        {totalCount > 0 && (
          <div className="flex justify-end px-4 py-2.5 border-t border-gray-100 dark:border-[#2a2f3e]">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      <UploadDocumentsDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onDocumentsUploaded={handleDocumentsUploaded}
      />

      {/* Clear Dialog */}
      <ConfirmDialog
        open={showClearDialog}
        title={
          statusFilter === "all"
            ? t("Clear All Documents")
            : t('Clear "{{status}}" Documents', {
                status:
                  statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1),
              })
        }
        message={
          statusFilter === "all"
            ? t("Are you sure you want to clear all documents?")
            : t(
                'Are you sure you want to clear all {{count}} "{{status}}" document(s)?',
                {
                  count: statusCounts[statusFilter],
                  status:
                    statusFilter.charAt(0).toUpperCase() +
                    statusFilter.slice(1),
                }
              )
        }
        confirmLabel={t("Clear")}
        confirmVariant="danger"
        isLoading={isClearing}
        onConfirm={handleClearConfirm}
        onCancel={() => !isClearing && setShowClearDialog(false)}
      />

      {/* Delete Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        title={t("Delete Documents")}
        message={t("Delete {{count}} selected document(s)?", {
          count: selectedDocIds.length,
        })}
        confirmLabel={t("Delete")}
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !isDeleting && setShowDeleteDialog(false)}
      />
    </div>
  );
}

export default observer(DocumentManager);

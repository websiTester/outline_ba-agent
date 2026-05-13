import { useState, useCallback } from "react";
import type { Editor } from "~/editor";
import type Document from "~/models/Document";
import { createOutlineDocument } from "../api";
import {
  ParseError,
  formatFrDocumentContent,
  formatNfrTableContent,
  parseRequirementsTable,
} from "../utils/parseRequirementsTable";

export type SplitState =
  | { status: "idle" }
  | { status: "loading"; successCount: number; totalCount: number }
  | { status: "done"; successCount: number; totalCount: number }
  | { status: "parse_error"; message: string }
  | { status: "partial_error"; successCount: number; totalCount: number };

type UseSplitRequirementsResult = {
  /** Parse document content and return total doc count. Throws ParseError on invalid content. */
  preview: () => number;
  split: () => Promise<void>;
  state: SplitState;
};

export function useSplitRequirements(
  document: Document,
  editorRef: React.RefObject<Editor>
): UseSplitRequirementsResult {
  const [state, setState] = useState<SplitState>({ status: "idle" });

  const preview = useCallback((): number => {
    const markdown = editorRef.current?.value(true);
    if (!markdown) {
      throw new ParseError(
        "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung"
      );
    }
    const { frItems } = parseRequirementsTable(markdown);
    // 1 FR parent + N FR items + 1 NFR doc
    return 1 + frItems.length + 1;
  }, [editorRef]);

  const split = useCallback(async () => {
    const markdown = editorRef.current?.value(true);

    if (!markdown) {
      setState({
        status: "parse_error",
        message:
          "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung",
      });
      return;
    }

    let parsed;
    try {
      parsed = parseRequirementsTable(markdown);
    } catch (err) {
      const message =
        err instanceof ParseError
          ? err.message
          : "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung";
      setState({ status: "parse_error", message });
      return;
    }

    const { frItems, nfrItems, headerRow, separatorRow } = parsed;
    // 1 FR parent doc + N FR item docs + 1 NFR doc
    const totalCount = 1 + frItems.length + 1;

    setState({ status: "loading", successCount: 0, totalCount });

    const collectionId = document.collectionId ?? "";
    let successCount = 0;

    // Step 1: Create "Functional Requirements" parent document
    let frParentId: string | null = null;
    try {
      const result = await createOutlineDocument(
        collectionId,
        "Functional Requirements",
        "",
        { parentDocumentId: document.id }
      );
      frParentId = result.id;
      successCount++;
      setState({ status: "loading", successCount, totalCount });
    } catch {
      // FR parent failed — skip all FR children, continue to NFR
    }

    // Step 2: Create one child document per FR item
    if (frParentId) {
      for (const row of frItems) {
        try {
          await createOutlineDocument(
            collectionId,
            `${row.id}: ${row.name}`,
            formatFrDocumentContent(row),
            {
              parentDocumentId: frParentId,
              sourceMetadata: { srsType: "functional_requirement" },
            }
          );
          successCount++;
        } catch {
          // partial failure — keep going
        }
        setState({ status: "loading", successCount, totalCount });
      }
    }

    // Step 3: Create "Non-Functional Requirements" document
    try {
      await createOutlineDocument(
        collectionId,
        "Non-Functional Requirements",
        formatNfrTableContent(nfrItems, headerRow, separatorRow),
        {
          parentDocumentId: document.id,
          sourceMetadata: { srsType: "non_functional_requirement" },
        }
      );
      successCount++;
    } catch {
      // partial failure
    }

    setState(
      successCount === totalCount
        ? { status: "done", successCount, totalCount }
        : { status: "partial_error", successCount, totalCount }
    );
  }, [document, editorRef]);

  return { preview, split, state };
}

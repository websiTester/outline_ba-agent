import { useCallback, useEffect } from "react";
import { Loader2, SplitSquareVertical } from "lucide-react";
import { toast } from "sonner";
import type { Editor } from "~/editor";
import type Document from "~/models/Document";
import Button from "~/components/Button";
import Tooltip from "~/components/Tooltip";
import useStores from "~/hooks/useStores";
import { ParseError } from "../utils/parseRequirementsTable";
import { useSplitRequirements } from "../hooks/useSplitRequirements";
import SplitConfirmationDialog from "./SplitConfirmationDialog";

type Props = {
  document: Document;
  editorRef: React.RefObject<Editor>;
};

export default function SplitRequirementsButton({ document, editorRef }: Props) {
  const { dialogs } = useStores();
  const { preview, split, state } = useSplitRequirements(document, editorRef);

  const isLoading = state.status === "loading";

  // Show toast when split completes
  useEffect(() => {
    if (state.status === "done") {
      toast.success(
        `Đã tạo thành công ${state.totalCount} documents`
      );
    } else if (state.status === "partial_error") {
      toast.warning(
        `Tạo được ${state.successCount}/${state.totalCount} documents, vui lòng thử lại`
      );
    } else if (state.status === "parse_error") {
      toast.error(state.message);
    }
  }, [state]);

  const handleClick = useCallback(() => {
    let totalCount: number;
    try {
      totalCount = preview();
    } catch (err) {
      const message =
        err instanceof ParseError
          ? err.message
          : "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung";
      toast.error(message);
      return;
    }

    dialogs.openModal({
      title: "Tách requirements",
      content: (
        <SplitConfirmationDialog
          totalCount={totalCount}
          onSubmit={async () => {
            dialogs.closeAllModals();
            await split();
          }}
        />
      ),
    });
  }, [preview, split, dialogs]);

  return (
    <Tooltip content="Tách requirements thành documents" placement="bottom">
      <Button
        onClick={handleClick}
        disabled={isLoading}
        neutral
        borderOnHover
        icon={
          isLoading ? (
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <SplitSquareVertical size={18} />
          )
        }
      />
    </Tooltip>
  );
}

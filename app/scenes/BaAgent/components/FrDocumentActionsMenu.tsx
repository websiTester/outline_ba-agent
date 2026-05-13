import * as React from "react";
import { GitBranchIcon, FileTextIcon } from "lucide-react";
import { observer } from "mobx-react";
import type Document from "~/models/Document";
import { createAction } from "~/actions";
import { ActiveDocumentSection } from "~/actions/sections";
import { DropdownMenu } from "~/components/Menu/DropdownMenu";
import { useMenuAction } from "~/hooks/useMenuAction";
import Button from "~/components/Button";
import Tooltip from "~/components/Tooltip";
import DocumentToolModal from "./DocumentToolModal";

type Props = {
  document: Document;
};

type ModalConfig = {
  toolName: string;
  title: string;
};

function FrDocumentActionsMenu({ document }: Props) {
  const [modalConfig, setModalConfig] = React.useState<ModalConfig | null>(null);

  const actions = React.useMemo(
    () => [
      createAction({
        name: "Draw diagram",
        analyticsName: "FR draw diagram",
        section: ActiveDocumentSection,
        icon: <GitBranchIcon size={16} />,
        visible: true,
        perform: () => {
          setModalConfig({ toolName: "draw_diagram", title: "Draw diagram" });
        },
      }),
      createAction({
        name: "Requirement specification",
        analyticsName: "FR requirement specification",
        section: ActiveDocumentSection,
        icon: <FileTextIcon size={16} />,
        visible: true,
        perform: () => {
          setModalConfig({ toolName: "requirement_specification", title: "Requirement specification" });
        },
      }),
    ],
    []
  );

  const rootAction = useMenuAction(actions);

  return (
    <>
      <Tooltip content="FR actions" placement="bottom">
        <DropdownMenu action={rootAction} align="end" ariaLabel="FR actions">
          <Button neutral borderOnHover>
            Actions
          </Button>
        </DropdownMenu>
      </Tooltip>
      {modalConfig && (
        <DocumentToolModal
          isOpen={!!modalConfig}
          onClose={() => setModalConfig(null)}
          toolName={modalConfig.toolName}
          title={modalConfig.title}
          document={document}
        />
      )}
    </>
  );
}

export default observer(FrDocumentActionsMenu);

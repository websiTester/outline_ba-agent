import ConfirmationDialog from "~/components/ConfirmationDialog";
import Text from "~/components/Text";

type Props = {
  totalCount: number;
  onSubmit: () => Promise<void>;
};

export default function SplitConfirmationDialog({ totalCount, onSubmit }: Props) {
  return (
    <ConfirmationDialog onSubmit={onSubmit} submitText="Tách">
      <Text type="secondary">
        Bạn có chắc muốn tách thành{" "}
        <strong>{totalCount} documents</strong> không? Thao tác này sẽ tạo thêm
        documents con bên dưới document hiện tại.
      </Text>
    </ConfirmationDialog>
  );
}

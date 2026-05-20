import compact from "lodash/compact";
import { observer } from "mobx-react";
import { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Text from "@shared/components/Text";
import type User from "~/models/User";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Badge from "~/components/Badge";
import { HEADER_HEIGHT } from "~/components/Header";
import {
  type Props as TableProps,
  SortableTable,
} from "~/components/SortableTable";
import Switch from "~/components/Switch";
import { type Column as TableColumn } from "~/components/Table";
import { ContextMenu } from "~/components/Menu/ContextMenu";
import { useUserMenuActions } from "~/hooks/useUserMenuActions";
import Time from "~/components/Time";
import useCurrentUser from "~/hooks/useCurrentUser";
import useMobile from "~/hooks/useMobile";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import UserMenu from "~/menus/UserMenu";
import { FILTER_HEIGHT } from "./StickyFilters";
import { HStack } from "~/components/primitives/HStack";
import { VStack } from "~/components/primitives/VStack";

const ROW_HEIGHT = 50;
const STICKY_OFFSET = HEADER_HEIGHT + FILTER_HEIGHT;

type Props = Omit<TableProps<User>, "columns" | "rowHeight"> & {
  canManage: boolean;
};

const UserRowContextMenu = observer(function UserRowContextMenu({
  user,
  menuLabel,
  children,
}: {
  user: User;
  menuLabel: string;
  children: React.ReactNode;
}) {
  const action = useUserMenuActions(user);
  return (
    <ContextMenu action={action} ariaLabel={menuLabel}>
      {children}
    </ContextMenu>
  );
});

// BA Kit (M2) — inline switch in the "Instance Admin" column that flips the
// flag through the policy-checked endpoint. Optimistic so the UI feels snappy;
// reverts and toasts on failure.
const InstanceAdminToggle = observer(function InstanceAdminToggle({
  user,
}: {
  user: User;
}) {
  const { users } = useStores();
  const { t } = useTranslation();
  const can = usePolicy(user);

  // Hide the control entirely when the actor lacks permission for this row
  // (e.g. non-admin target, suspended user, cross-team viewer).
  if (!can.updateInstanceAdmin) {
    return (
      <Text type="tertiary" selectable={false}>
        —
      </Text>
    );
  }

  const handleChange = async (nextValue: boolean) => {
    // optimistic flip so the switch animates without waiting for the network
    const previous = user.isInstanceAdmin;
    user.isInstanceAdmin = nextValue;
    try {
      await users.updateInstanceAdmin(user, nextValue);
      toast.success(
        nextValue
          ? t("{{ name }} is now an instance admin", { name: user.name })
          : t("Revoked instance admin from {{ name }}", { name: user.name })
      );
    } catch (err) {
      // revert + surface the server message so the admin knows why it failed
      user.isInstanceAdmin = previous;
      toast.error(
        err?.message ?? t("Could not update instance admin status")
      );
    }
  };

  return (
    <Switch
      checked={user.isInstanceAdmin === true}
      onChange={handleChange}
      aria-label={t("Instance admin")}
      inForm={false}
    />
  );
});

export function MembersTable({ canManage, ...rest }: Props) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const isMobile = useMobile();

  const applyContextMenu = useCallback(
    (user: User, rowElement: React.ReactNode) => {
      if (currentUser.id === user.id) {
        return rowElement;
      }

      return (
        <UserRowContextMenu user={user} menuLabel={t("User options")}>
          {rowElement}
        </UserRowContextMenu>
      );
    },
    [currentUser.id, t]
  );

  const columns = useMemo<TableColumn<User>[]>(
    () =>
      compact<TableColumn<User>>([
        {
          type: "data",
          id: "name",
          header: t("Name"),
          accessor: (user) => user.name,
          component: (user) => (
            <HStack>
              <Avatar model={user} size={AvatarSize.Large} />
              <VStack align="flex-start" spacing={0}>
                <Text selectable>
                  {user.name} {currentUser.id === user.id && `(${t("You")})`}
                </Text>
                {isMobile && canManage && (
                  <Text type="tertiary" selectable>
                    {user.email}
                  </Text>
                )}
              </VStack>
            </HStack>
          ),
          width: "4fr",
        },
        canManage && !isMobile
          ? {
            type: "data",
            id: "email",
            header: t("Email"),
            accessor: (user) => user.email,
            component: (user) => <>{user.email}</>,
            width: "4fr",
          }
          : undefined,
        isMobile
          ? undefined
          : {
            type: "data",
            id: "lastActiveAt",
            header: t("Last active"),
            accessor: (user) => user.lastActiveAt,
            component: (user) =>
              user.lastActiveAt ? (
                <Time dateTime={user.lastActiveAt} addSuffix />
              ) : null,
            width: "2fr",
          },
        {
          type: "data",
          id: "role",
          header: t("Role"),
          accessor: (user) => user.role,
          component: (user) => (
            <HStack spacing={4} wrap>
              {!user.lastActiveAt && <Badge>{t("Invited")}</Badge>}
              {user.isAdmin ? (
                <Badge primary>{t("Admin")}</Badge>
              ) : user.isViewer ? (
                <Badge>{t("Viewer")}</Badge>
              ) : user.isGuest ? (
                <Badge>{t("Guest")}</Badge>
              ) : (
                <Badge>{t("Editor")}</Badge>
              )}
              {user.isSuspended && <Badge>{t("Suspended")}</Badge>}
            </HStack>
          ),
          width: "2fr",
        },
        // BA Kit (M2) — Q6: only workspace admins see the column at all
        canManage && !isMobile
          ? {
            type: "data",
            id: "isInstanceAdmin",
            header: t("BA Kit"),
            accessor: (user) => (user.isInstanceAdmin ? "1" : "0"),
            component: (user) => <InstanceAdminToggle user={user} />,
            width: "2fr",
          }
          : undefined,
        canManage
          ? {
            type: "action",
            id: "action",
            component: (user) =>
              currentUser.id !== user.id ? <UserMenu user={user} /> : null,
            width: "50px",
          }
          : undefined,
      ]),
    [t, currentUser, canManage, isMobile]
  );

  return (
    <SortableTable
      columns={columns}
      rowHeight={ROW_HEIGHT}
      stickyOffset={STICKY_OFFSET}
      decorateRow={canManage ? applyContextMenu : undefined}
      {...rest}
    />
  );
}

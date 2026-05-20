import type {
  NotificationSettings,
  UserPreferences,
  UserRole,
} from "@shared/types";
import env from "@server/env";
import type { User } from "@server/models";

type Options = {
  includeDetails?: boolean;
  includeEmail?: boolean;
};

type UserPresentation = {
  id: string;
  name: string;
  avatarUrl: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  lastActiveAt: Date | null;
  color: string;
  role: UserRole;
  isSuspended: boolean;
  // BA Kit (M2) — needed so the FE can gate the "BA Kit Admin" Settings menu
  // item without an extra round-trip. Exposed for self only (auth.info).
  isInstanceAdmin: boolean;
  email?: string | null;
  language?: string;
  preferences?: UserPreferences | null;
  notificationSettings?: NotificationSettings;
  timezone?: string | null;
};

export default function presentUser(
  user: User,
  options: Options = {}
): UserPresentation {
  const userData: UserPresentation = {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    color: user.color,
    role: user.role,
    isSuspended: user.isSuspended,
    isInstanceAdmin: user.isInstanceAdmin === true, // BA Kit M2 — Q11/Q48
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
    lastActiveAt: user.lastActiveAt,
    timezone: user.timezone,
  };

  if (options.includeDetails) {
    userData.email = user.email;
    userData.language = user.language || env.DEFAULT_LANGUAGE;
    userData.preferences = user.preferences;
    userData.notificationSettings = user.notificationSettings;
  }

  if (options.includeEmail) {
    userData.email = user.email;
  }

  return userData;
}

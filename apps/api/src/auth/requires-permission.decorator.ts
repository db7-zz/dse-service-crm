import { SetMetadata } from "@nestjs/common";
import type { PermissionCode } from "@dse/shared";

export const REQUIRED_PERMISSION = "requiredPermission";

export const RequiresPermission = (permission: PermissionCode) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

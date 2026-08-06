import { render, screen } from "@testing-library/react";
import { PermissionCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionPage } from "./permission-page";
import { useAuth } from "./auth-context";

vi.mock("./auth-context", () => ({
  useAuth: vi.fn(),
}));

const useAuthMock = vi.mocked(useAuth);
const administrator: AuthenticatedUser = {
  id: "administrator-id",
  username: "admin",
  displayName: "管理员",
  roles: [RoleCode.ADMINISTRATOR],
  permissions: [PermissionCode.SYSTEM_USERS_READ],
  mustChangePassword: false,
};

function authValue(user: AuthenticatedUser | null): ReturnType<typeof useAuth> {
  return {
    user,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
}

describe("PermissionPage", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it("renders the protected content when permission is present", () => {
    useAuthMock.mockReturnValue(authValue(administrator));
    render(
      <PermissionPage permission={PermissionCode.SYSTEM_USERS_READ}>
        <span>账号管理内容</span>
      </PermissionPage>,
    );

    expect(screen.getByText("账号管理内容")).toBeInTheDocument();
  });

  it("renders the permission state when permission is absent", () => {
    useAuthMock.mockReturnValue(
      authValue({
        ...administrator,
        permissions: [],
      }),
    );
    render(
      <PermissionPage permission={PermissionCode.SYSTEM_USERS_READ}>
        <span>账号管理内容</span>
      </PermissionPage>,
    );

    expect(screen.queryByText("账号管理内容")).not.toBeInTheDocument();
    expect(screen.getByText("当前角色没有访问此页面的权限")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工作区" })).toHaveAttribute("href", "/workspace");
  });
});

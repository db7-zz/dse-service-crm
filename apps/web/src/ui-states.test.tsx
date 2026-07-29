import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState, ErrorState, LoadingState } from "@dse/ui";
import { describe, expect, it, vi } from "vitest";

describe("shared UI states", () => {
  it("renders a loading skeleton", () => {
    const { container } = render(<LoadingState rows={3} />);
    expect(container.querySelector(".ant-skeleton")).toBeInTheDocument();
  });

  it("renders empty content and its action", () => {
    render(<EmptyState title="暂无账号" action={<button>创建账号</button>} />);
    expect(screen.getByText("暂无账号")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建账号" })).toBeEnabled();
  });

  it("offers a retry action for failed content", () => {
    const retry = vi.fn();
    render(<ErrorState message="加载账号失败" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

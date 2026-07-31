import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentsPage from "../../app/workspace/students/page";
import { getResponsiblePersonOptions, listStudents } from "./student-api";

vi.mock("../auth/permission-page", () => ({
  PermissionPage: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./student-api", () => ({
  getResponsiblePersonOptions: vi.fn(),
  listStudents: vi.fn(),
}));

const listStudentsMock = vi.mocked(listStudents);
const optionsMock = vi.mocked(getResponsiblePersonOptions);

describe("student list states", () => {
  beforeEach(() => {
    listStudentsMock.mockReset();
    optionsMock.mockReset();
    optionsMock.mockResolvedValue({ butlers: [], planners: [] });
  });

  it("shows the first-record empty state", async () => {
    listStudentsMock.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    render(<StudentsPage />);

    expect(await screen.findByText("还没有学生档案")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建第一位学生" })).toBeEnabled();
  });

  it("shows a retry action when loading fails", async () => {
    listStudentsMock.mockRejectedValue(new Error("测试网络错误"));

    render(<StudentsPage />);

    expect(await screen.findByText("学生列表暂时无法加载")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重\s*试/ })).toBeEnabled();
  });
});

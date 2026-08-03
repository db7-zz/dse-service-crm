import { describe, expect, it } from "vitest";
import { validateUploadFile } from "./file-upload";

describe("validateUploadFile", () => {
  it("infers a browser-missing MIME type from an allowed extension", () => {
    const file = new File(["demo"], "transcript.doc", { type: "" });
    expect(validateUploadFile(file)).toEqual({ mimeType: "application/msword" });
  });

  it("rejects unsupported extensions before upload", () => {
    const file = new File(["demo"], "archive.exe", { type: "application/octet-stream" });
    expect(() => validateUploadFile(file)).toThrow("仅支持");
  });

  it("rejects empty files before upload", () => {
    const file = new File([], "empty.pdf", { type: "application/pdf" });
    expect(() => validateUploadFile(file)).toThrow("不能为空");
  });
});

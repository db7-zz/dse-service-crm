import { ApiClient } from "@dse/api-client";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

export const apiClient = new ApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1",
  csrfToken: () => {
    const encoded = readCookie("dse_csrf");
    return encoded ? decodeURIComponent(encoded) : undefined;
  },
});

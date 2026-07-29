import type { ApiEnvelope } from "@dse/shared";

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly envelope?: ApiEnvelope<unknown>,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  csrfToken?: () => string | undefined;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly csrfToken?: () => string | undefined;

  public constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "/api/v1";
    this.csrfToken = options.csrfToken;
  }

  public async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const csrf = this.csrfToken?.();
    if (csrf) {
      headers.set("X-CSRF-Token", csrf);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
    const envelope = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !envelope.success) {
      const message = envelope.success ? "请求失败" : envelope.error.message;
      throw new ApiClientError(message, response.status, envelope as ApiEnvelope<unknown>);
    }
    return envelope.data;
  }
}

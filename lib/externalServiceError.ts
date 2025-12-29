export type ExternalProvider = "reddit-search" | "unknown";

export class ExternalServiceError extends Error {
  provider: ExternalProvider;
  status?: number;
  retryable: boolean;
  rawSnippet?: string;

  constructor(opts: {
    provider: ExternalProvider;
    message: string;
    status?: number;
    retryable: boolean;
    rawSnippet?: string;
  }) {
    super(opts.message);
    this.name = "ExternalServiceError";
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.rawSnippet = opts.rawSnippet;

    // Ensure fields survive structured cloning/logging in some runtimes
    Object.defineProperty(this, "provider", { enumerable: true, value: this.provider });
    Object.defineProperty(this, "status", { enumerable: true, value: this.status });
    Object.defineProperty(this, "retryable", { enumerable: true, value: this.retryable });
    Object.defineProperty(this, "rawSnippet", { enumerable: true, value: this.rawSnippet });
  }
}

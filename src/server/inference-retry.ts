export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public kind:
      | "transient"
      | "context_limit"
      | "output_limit"
      | "invalid" = "transient",
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}
/** Only inference HTTP calls are repeated; this never wraps database writes. */
export async function retryInference<T>(
  operation: () => Promise<T>,
  wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        !error.retryable ||
        attempt >= 1 ||
        error.retryAfterMs > 10000
      )
        throw error;
      await wait(Math.max(800, error.retryAfterMs));
    }
  }
}

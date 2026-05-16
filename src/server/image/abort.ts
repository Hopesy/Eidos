export function createAbortError(message = "request canceled") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (
      error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted") ||
      error.message.toLowerCase().includes("canceled")
    )
  );
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function createLinkedAbortController(parentSignal?: AbortSignal, timeoutMs = 30000) {
  throwIfAborted(parentSignal);

  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal?.aborted) {
    abortFromParent();
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    parentAborted: () => Boolean(parentSignal?.aborted),
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function abortableDelay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  });
}

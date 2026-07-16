// Coalesces identical in-flight operations while isolating each caller's response.
// Объединяет одинаковые выполняющиеся операции, изолируя ответ каждого caller.
export class InFlightRequestCoalescer {
  private readonly requests = new Map<string, Promise<unknown>>();

  async run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(key) as Promise<T> | undefined;

    if (existing) {
      return cloneResult(await existing);
    }

    const pending = Promise.resolve().then(load);
    this.requests.set(key, pending);

    try {
      return cloneResult(await pending);
    } finally {
      if (this.requests.get(key) === pending) {
        this.requests.delete(key);
      }
    }
  }
}

function cloneResult<T>(value: T): T {
  return structuredClone(value);
}

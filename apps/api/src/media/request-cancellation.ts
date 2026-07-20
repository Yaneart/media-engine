interface HttpRequestLifecycle {
  aborted: boolean;
  complete: boolean;
  once(event: 'aborted' | 'close', listener: () => void): unknown;
  removeListener(event: 'aborted' | 'close', listener: () => void): unknown;
}

interface HttpResponseLifecycle {
  writableEnded: boolean;
  once(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
}

// EN: Cancel engine work when the HTTP peer disconnects and always detach lifecycle listeners.
// RU: Отменяет работу движка при disconnect HTTP-клиента и всегда снимает lifecycle listeners.
export async function runWithHttpRequestSignal<T>(
  request: HttpRequestLifecycle,
  response: HttpResponseLifecycle,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(createClientAbortError());
    }
  };
  const onRequestClose = () => {
    if (request.aborted || !request.complete) {
      abort();
    }
  };
  const onResponseClose = () => {
    if (!response.writableEnded) {
      abort();
    }
  };

  request.once('aborted', abort);
  request.once('close', onRequestClose);
  response.once('close', onResponseClose);

  try {
    if (request.aborted) {
      abort();
    }

    return await operation(controller.signal);
  } catch (error) {
    // EN: The peer is already gone; settle quietly instead of logging an expected Nest 500.
    // RU: Клиент уже ушел; завершаемся тихо вместо ожидаемой записи Nest 500 в лог.
    if (controller.signal.aborted && error === controller.signal.reason) {
      return undefined;
    }

    throw error;
  } finally {
    request.removeListener('aborted', abort);
    request.removeListener('close', onRequestClose);
    response.removeListener('close', onResponseClose);
  }
}

function createClientAbortError(): Error {
  const error = new Error(
    'HTTP client disconnected before the response completed.',
  );
  error.name = 'AbortError';
  return error;
}

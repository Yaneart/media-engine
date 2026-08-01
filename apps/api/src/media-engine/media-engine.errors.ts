import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Maps core errors structurally so the CommonJS Nest app does not load the ESM-only class.
// Структурно отображает core errors без загрузки ESM-only класса из CommonJS Nest app.
export function rethrowMediaEngineHttpError(error: unknown): never {
  if (isMediaEngineError(error, 'INVALID_QUERY')) {
    throw new BadRequestException(error.message);
  }

  if (isMediaEngineError(error, 'PROVIDER_ERROR')) {
    throw new ServiceUnavailableException(error.message);
  }

  throw error;
}

function isMediaEngineError(
  error: unknown,
  code: 'INVALID_QUERY' | 'PROVIDER_ERROR',
): error is { message: string } {
  if (!error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;

  return (
    value.name === 'MediaEngineError' &&
    value.code === code &&
    typeof value.message === 'string'
  );
}

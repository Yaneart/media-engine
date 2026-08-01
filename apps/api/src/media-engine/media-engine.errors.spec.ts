import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { rethrowMediaEngineHttpError } from './media-engine.errors';

describe('MediaEngine HTTP error mapping', () => {
  it.each([
    ['INVALID_QUERY', BadRequestException],
    ['PROVIDER_ERROR', ServiceUnavailableException],
  ] as const)(
    'maps %s without loading the runtime error class',
    (code, Type) => {
      expect(() =>
        rethrowMediaEngineHttpError({
          name: 'MediaEngineError',
          code,
          message: 'mapped failure',
        }),
      ).toThrow(Type);
    },
  );

  it('preserves unrelated failures', () => {
    const failure = new Error('unrelated failure');

    expect(() => rethrowMediaEngineHttpError(failure)).toThrow(failure);
  });
});

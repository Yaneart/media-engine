import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import {
  EXTERNAL_ID_KEYS,
  TOP_LEVEL_EXTERNAL_ID_KEYS,
} from './media-query.constants';

// Documents the shared top-level shortcuts and complete ids.* namespace.
// Документирует общие верхнеуровневые сокращения и полный namespace ids.*.
export function ApiExternalIdQueryParameters() {
  return applyDecorators(
    ...TOP_LEVEL_EXTERNAL_ID_KEYS.map((name) =>
      ApiQuery({ name, required: false, type: String }),
    ),
    ...EXTERNAL_ID_KEYS.map((name) =>
      ApiQuery({ name: `ids.${name}`, required: false, type: String }),
    ),
  );
}

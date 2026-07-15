import type { ExternalIds } from "../media/index.js";
import { STRONG_ID_KEYS } from "./internal.js";

// Checks whether two ID maps share at least one strong external ID.
// Проверяет, есть ли у двух карт ID хотя бы один общий сильный внешний ID.
export function hasSharedStrongId(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return STRONG_ID_KEYS.some((key) => Boolean(left[key] && right[key] && left[key] === right[key]));
}

// Checks whether two ID maps contain conflicting strong external IDs.
// Проверяет, содержат ли две карты ID конфликтующие сильные внешние ID.
export function hasStrongIdConflict(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  return strongIdConflicts(left, right).length > 0;
}

export function strongIdConflicts(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): Array<(typeof STRONG_ID_KEYS)[number]> {
  if (!left || !right) {
    return [];
  }

  return STRONG_ID_KEYS.filter((key) =>
    Boolean(left[key] && right[key] && left[key] !== right[key]),
  );
}

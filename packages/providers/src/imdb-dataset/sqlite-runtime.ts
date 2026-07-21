import type { DatabaseSync } from "node:sqlite";

export type ImdbSqliteDatabase = DatabaseSync;

export async function createImdbSqliteDatabase(
  path: string,
  options?: ConstructorParameters<typeof DatabaseSync>[1],
): Promise<DatabaseSync> {
  let DatabaseSyncConstructor: typeof DatabaseSync;

  try {
    ({ DatabaseSync: DatabaseSyncConstructor } = await import("node:sqlite"));
  } catch (error) {
    throw new Error(
      "The persisted IMDb SQLite backend requires Node.js 22.13 or newer with node:sqlite support",
      { cause: error },
    );
  }

  return new DatabaseSyncConstructor(path, options);
}

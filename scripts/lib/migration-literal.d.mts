/** The types of `migration-literal.mjs`, for the API test that loads it by `await import()`. */
export declare const MIGRATIONS_DIR: string;

export declare function migrationLiteral(
  name: string,
  dir?: string,
): { file: string; value: unknown };

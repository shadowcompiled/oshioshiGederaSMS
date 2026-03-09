declare module "better-sqlite3" {
  interface SqliteDb {
    prepare(sql: string): {
      run(...args: unknown[]): { changes: number };
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
    exec(sql: string): void;
    close(): void;
  }
  function betterSqlite3(path: string): SqliteDb;
  export = betterSqlite3;
}

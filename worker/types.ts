export interface D1Meta {
  last_row_id?: number;
  changes?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  DB: D1Database;
  ASSETS?: AssetsFetcher;
  SESSION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_INITIAL_PASSWORD?: string;
  ADMIN_API_KEY?: string;
}

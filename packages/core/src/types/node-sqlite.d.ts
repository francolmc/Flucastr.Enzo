declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: any[]): unknown;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

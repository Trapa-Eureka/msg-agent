import type { LogMeta, Logger } from "../core/index.js";

export interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  meta: LogMeta;
}

/** Records log calls; `dump()` serializes everything for privacy signature checks. */
export class CapturingLogger implements Logger {
  readonly entries: LogEntry[] = [];
  info(event: string, meta: LogMeta = {}): void {
    this.entries.push({ level: "info", event, meta });
  }
  warn(event: string, meta: LogMeta = {}): void {
    this.entries.push({ level: "warn", event, meta });
  }
  error(event: string, meta: LogMeta = {}): void {
    this.entries.push({ level: "error", event, meta });
  }
  events(): string[] {
    return this.entries.map((e) => e.event);
  }
  dump(): string {
    return JSON.stringify(this.entries);
  }
}

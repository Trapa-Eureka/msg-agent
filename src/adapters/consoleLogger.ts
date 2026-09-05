// JSON-lines logger to stderr. Metadata only — callers never pass document text (guardrail 1).
import type { LogMeta, Logger } from "../core/index.js";

export class ConsoleLogger implements Logger {
  constructor(
    private readonly write: (line: string) => void = (l) => process.stderr.write(`${l}\n`),
  ) {}
  private emit(level: string, event: string, meta: LogMeta): void {
    this.write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...meta }));
  }
  info(event: string, meta: LogMeta = {}): void {
    this.emit("info", event, meta);
  }
  warn(event: string, meta: LogMeta = {}): void {
    this.emit("warn", event, meta);
  }
  error(event: string, meta: LogMeta = {}): void {
    this.emit("error", event, meta);
  }
}

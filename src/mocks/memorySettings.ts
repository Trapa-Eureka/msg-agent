import type { Config, SettingsStore } from "../core/index.js";

export class MemorySettings implements SettingsStore {
  readonly saves: Config[] = [];
  constructor(private config: Config) {}
  get(): Config {
    return this.config;
  }
  set(next: Config): Promise<void> {
    this.config = next;
    this.saves.push(next);
    return Promise.resolve();
  }
}

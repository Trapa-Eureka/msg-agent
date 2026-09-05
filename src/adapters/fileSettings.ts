// SettingsStore over configStore: cached config, persisted with mode 600 on every change.
import type { Config, SettingsStore } from "../core/index.js";
import { explainConfigError, formatExplanations } from "../core/index.js";
import { saveConfig } from "./configStore.js";

export class FileSettings implements SettingsStore {
  constructor(
    private config: Config,
    private readonly path: string,
  ) {}
  get(): Config {
    return this.config;
  }
  async set(next: Config): Promise<void> {
    const r = saveConfig(next, this.path);
    if (!r.ok) throw new Error(formatExplanations(explainConfigError(r.error, "en"), "en"));
    this.config = r.value;
    await Promise.resolve();
  }
}

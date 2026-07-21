import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings
} from "../shared/settings";

export class SettingsStore {
  private readonly filePath: string;
  private settings: AppSettings;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "settings.json");
    this.settings = this.read();
  }

  get(): AppSettings {
    return { ...this.settings, jiaoKeyCodes: [...this.settings.jiaoKeyCodes] };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.write();
    return this.get();
  }

  private read(): AppSettings {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS };
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.settings, null, 2), "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}

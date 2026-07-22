import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings
} from "../shared/settings";

export const SETTINGS_SCHEMA_VERSION = 1;

interface StoredSettingsV1 {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  settings: AppSettings;
}

interface ReadResult {
  settings: AppSettings;
  notice: string | null;
  rewrite: boolean;
}

function cloneDefaults(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    jiaoKeyCodes: [...DEFAULT_SETTINGS.jiaoKeyCodes]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export class SettingsStore {
  private readonly filePath: string;
  private readonly backupPath: string;
  private settings: AppSettings;
  private notice: string | null;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "settings.json");
    this.backupPath = join(userDataPath, "settings.json.bak");
    const result = this.read();
    this.settings = result.settings;
    this.notice = result.notice;
    if (result.rewrite) {
      try {
        this.write(result.settings);
      } catch {
        this.notice = this.notice
          ? `${this.notice}，但暂时无法写回磁盘`
          : "设置已读取，但暂时无法写回磁盘";
      }
    }
  }

  get(): AppSettings {
    return { ...this.settings, jiaoKeyCodes: [...this.settings.jiaoKeyCodes] };
  }

  getNotice(): string | null {
    return this.notice;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const candidate = normalizeSettings({ ...this.settings, ...patch });
    this.write(candidate);
    this.settings = candidate;
    return this.get();
  }

  private read(): ReadResult {
    if (!existsSync(this.filePath)) {
      return { settings: cloneDefaults(), notice: null, rewrite: true };
    }
    try {
      return this.parseFile(this.filePath);
    } catch {
      this.preserveCorruptFile();
      if (existsSync(this.backupPath)) {
        try {
          const recovered = this.parseFile(this.backupPath);
          return {
            settings: recovered.settings,
            notice: "设置文件损坏，已从备份恢复",
            rewrite: true
          };
        } catch {
          // Fall through to clean defaults when both copies are unreadable.
        }
      }
      return {
        settings: cloneDefaults(),
        notice: "设置文件损坏，已恢复默认设置",
        rewrite: true
      };
    }
  }

  private parseFile(path: string): ReadResult {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isRecord(parsed) && parsed.schemaVersion === SETTINGS_SCHEMA_VERSION) {
      return {
        settings: normalizeSettings(parsed.settings),
        notice: null,
        rewrite: false
      };
    }
    if (isRecord(parsed) && "schemaVersion" in parsed) {
      throw new Error("Unsupported settings schema");
    }
    return {
      settings: normalizeSettings(parsed),
      notice: "设置文件已升级到新版格式",
      rewrite: true
    };
  }

  private preserveCorruptFile(): void {
    if (!existsSync(this.filePath)) return;
    const corruptPath = join(
      dirname(this.filePath),
      `settings.corrupt-${Date.now()}.json`
    );
    try {
      renameSync(this.filePath, corruptPath);
    } catch {
      // Keep the original in place if it cannot be renamed.
    }
  }

  private write(nextSettings: AppSettings): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const stored: StoredSettingsV1 = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: nextSettings
    };
    try {
      writeFileSync(temporaryPath, JSON.stringify(stored, null, 2), "utf8");
      if (existsSync(this.filePath)) {
        copyFileSync(this.filePath, this.backupPath);
      }
      renameSync(temporaryPath, this.filePath);
    } catch (error: unknown) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

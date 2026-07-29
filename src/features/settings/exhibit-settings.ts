import {
  DEFAULT_REDACTION_CONFIG,
  DEFAULT_REDACTION_FIELD_NAMES,
  type RedactionConfig,
} from './redaction-settings';

export type ThemeMode = 'dark' | 'devtools' | 'light' | 'system';

export type ExhibitSettings = Readonly<{
  customFieldNames: readonly string[];
  theme: ThemeMode;
}>;

export type ExhibitSettingsService = Readonly<{
  initial: ExhibitSettings;
  saveCustomFieldNames(customFieldNames: readonly string[]): Promise<ExhibitSettings>;
  saveTheme(theme: ThemeMode): Promise<ExhibitSettings>;
}>;

export interface SettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export interface ExhibitSettingsRepository {
  load(): Promise<ExhibitSettings>;
  save(settings: ExhibitSettings): Promise<ExhibitSettings>;
  restrictToTrustedContexts(): Promise<void>;
}

const SETTINGS_KEY = 'exhibit:settings:v1';
const SETTINGS_VERSION = 1;
const MAX_CUSTOM_FIELD_NAMES = 64;
const MAX_FIELD_NAME_CODE_POINTS = 80;
const MAX_TOTAL_FIELD_NAME_CODE_POINTS = 4_096;
const THEMES = new Set<ThemeMode>(['dark', 'devtools', 'light', 'system']);

/**
 * The panel is hosted inside DevTools, so it follows the DevTools theme by
 * default. Following the operating system instead lets the panel arrive light
 * inside a dark DevTools window, which reads as a rendering fault.
 */
export const DEFAULT_EXHIBIT_SETTINGS: ExhibitSettings = Object.freeze({
  customFieldNames: Object.freeze([]),
  theme: 'devtools',
});

function canonicalFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function freezeSettings(settings: ExhibitSettings): ExhibitSettings {
  return Object.freeze({
    customFieldNames: Object.freeze([...settings.customFieldNames]),
    theme: settings.theme,
  });
}

export function normalizeCustomFieldNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  let totalCodePoints = 0;
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const name = candidate.normalize('NFC').trim();
    const codePoints = [...name].length;
    const canonical = canonicalFieldName(name);
    if (
      name === '' ||
      canonical === '' ||
      codePoints > MAX_FIELD_NAME_CODE_POINTS ||
      seen.has(canonical) ||
      result.length >= MAX_CUSTOM_FIELD_NAMES ||
      totalCodePoints + codePoints > MAX_TOTAL_FIELD_NAME_CODE_POINTS
    ) {
      continue;
    }
    seen.add(canonical);
    totalCodePoints += codePoints;
    result.push(name);
  }
  return Object.freeze(result);
}

export function parseCustomFieldNames(value: string): readonly string[] {
  return normalizeCustomFieldNames(value.split(/[,\n]/u));
}

export function buildRedactionConfig(settings: ExhibitSettings): RedactionConfig {
  return Object.freeze({
    ...DEFAULT_REDACTION_CONFIG,
    fieldNames: Object.freeze([
      ...DEFAULT_REDACTION_FIELD_NAMES,
      ...normalizeCustomFieldNames(settings.customFieldNames),
    ]),
  });
}

function ownValue(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function decodeSettings(value: unknown): ExhibitSettings {
  if (value === null || typeof value !== 'object') {
    return DEFAULT_EXHIBIT_SETTINGS;
  }
  try {
    const keys = Object.getOwnPropertyNames(value).sort();
    if (
      keys.join('\n') !== 'customFieldNames\ntheme\nversion' ||
      ownValue(value, 'version') !== SETTINGS_VERSION
    ) {
      return DEFAULT_EXHIBIT_SETTINGS;
    }
    const theme = ownValue(value, 'theme');
    const customFieldNames = ownValue(value, 'customFieldNames');
    if (
      typeof theme !== 'string' ||
      !THEMES.has(theme as ThemeMode) ||
      !Array.isArray(customFieldNames) ||
      customFieldNames.some((name) => typeof name !== 'string')
    ) {
      return DEFAULT_EXHIBIT_SETTINGS;
    }
    return freezeSettings({
      customFieldNames: normalizeCustomFieldNames(customFieldNames),
      theme: theme as ThemeMode,
    });
  } catch {
    return DEFAULT_EXHIBIT_SETTINGS;
  }
}

export function createExhibitSettingsRepository(
  area: SettingsStorageArea,
): ExhibitSettingsRepository {
  return {
    async load(): Promise<ExhibitSettings> {
      const values = await area.get(SETTINGS_KEY);
      return decodeSettings(values[SETTINGS_KEY]);
    },

    async save(settings): Promise<ExhibitSettings> {
      const normalized = freezeSettings({
        customFieldNames: normalizeCustomFieldNames(settings.customFieldNames),
        theme: THEMES.has(settings.theme) ? settings.theme : 'system',
      });
      await area.set({
        [SETTINGS_KEY]: {
          version: SETTINGS_VERSION,
          theme: normalized.theme,
          customFieldNames: [...normalized.customFieldNames],
        },
      });
      return normalized;
    },

    async restrictToTrustedContexts(): Promise<void> {
      await area.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    },
  };
}

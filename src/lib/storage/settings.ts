import type { Mode, ThemeId, Tokens } from '../../theme/themes';

export type Settings = {
  geminiKey: string; githubToken: string; owner: string; repo: string; model: string;
  maxPerMinute: number; maxPerDay: number; lotPages: number;
  theme: ThemeId; mode: Mode;
  themeOverrides: { light?: Partial<Tokens>; dark?: Partial<Tokens> };
};

const KEY = 'sequentia.settings';
const defaults = (): Settings => ({
  geminiKey: '', githubToken: '', owner: '', repo: '',
  model: 'gemini-3.8-flash', // MODEL par défaut de Fiches/orchestrate.py
  maxPerMinute: 5, maxPerDay: 100, lotPages: 5,
  theme: 'd', mode: 'auto', themeOverrides: {},
});

let memory: string | null = null; // repli si localStorage est indisponible
const readRaw = (): string | null => { try { return localStorage.getItem(KEY); } catch { return memory; } };
const writeRaw = (v: string): void => { try { localStorage.setItem(KEY, v); } catch { memory = v; } };

export function getSettings(): Settings {
  try {
    const raw = readRaw();
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return { ...defaults(), ...(parsed && typeof parsed === 'object' ? (parsed as Partial<Settings>) : {}) };
  } catch {
    return defaults();
  }
}

export function saveSettings(patch: Partial<Settings>): void {
  writeRaw(JSON.stringify({ ...getSettings(), ...patch }));
}

export function clearKeys(): void {
  saveSettings({ geminiKey: '', githubToken: '' });
}

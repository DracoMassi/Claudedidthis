import { beforeEach, describe, expect, it } from 'vitest';
import { clearKeys, getSettings, saveSettings } from '../src/lib/storage/settings';

beforeEach(() => localStorage.clear());

describe('settings', () => {
  it('a les valeurs par défaut du plan', () => {
    const s = getSettings();
    expect(s.maxPerMinute).toBe(5);
    expect(s.maxPerDay).toBe(100);
    expect(s.lotPages).toBe(5);
    expect(s.theme).toBe('d');
    expect(s.mode).toBe('auto');
    expect(s.themeOverrides).toEqual({});
    expect(s.geminiKey).toBe('');
    expect(s.githubToken).toBe('');
    expect(s.model).toBe('gemini-3.8-flash'); // MODEL par défaut de Fiches/orchestrate.py
  });
  it('conserve un réglage enregistré', () => {
    saveSettings({ owner: 'moi', repo: 'Fiches', maxPerDay: 40 });
    expect(getSettings()).toMatchObject({ owner: 'moi', repo: 'Fiches', maxPerDay: 40, maxPerMinute: 5 });
  });
  it('clearKeys vide les deux clés mais garde le modèle et le reste', () => {
    saveSettings({ geminiKey: 'g', githubToken: 't', model: 'autre-modele', owner: 'moi' });
    clearKeys();
    const s = getSettings();
    expect(s.geminiKey).toBe('');
    expect(s.githubToken).toBe('');
    expect(s.model).toBe('autre-modele');
    expect(s.owner).toBe('moi');
  });
  it('retombe sur les défauts si le stockage contient du JSON invalide', () => {
    localStorage.setItem('sequentia.settings', '{pas du json');
    expect(getSettings().maxPerMinute).toBe(5);
  });
});

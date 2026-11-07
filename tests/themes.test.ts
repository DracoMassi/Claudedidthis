import { describe, expect, it } from 'vitest';
import { THEMES, applyTheme, contrastRatio, contrastWarnings, resolveMode, type Tokens, type TokenName } from '../src/theme/themes';

const NOMS: TokenName[] = ['--page-bg', '--grid-line', '--card', '--card-border', '--accent', '--accent-text', '--accent-dark', '--logo', '--badge-bg', '--ok-bg', '--ok-text', '--text'];
const HEX = /^(#[0-9A-Fa-f]{6}|transparent)$/;

describe('THEMES', () => {
  for (const id of ['ac', 'a', 'b', 'c', 'd'] as const) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${id}/${mode} définit les douze variables`, () => {
        const t = THEMES[id][mode];
        for (const n of NOMS) expect(t[n], `${id}/${mode} ${n}`).toMatch(HEX);
        expect(Object.keys(t).sort()).toEqual([...NOMS].sort());
      });
      it(`${id}/${mode} respecte les contrastes`, () => {
        const t = THEMES[id][mode];
        expect(contrastRatio(t['--text'], t['--page-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t['--text'], t['--card'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t['--accent-text'], t['--page-bg'])).toBeGreaterThanOrEqual(3);
        expect(contrastRatio('#FFFFFF', t['--accent'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t['--accent-dark'], t['--badge-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t['--ok-text'], t['--ok-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastWarnings(t)).toEqual([]);
      });
    }
  }
  it('valeurs sombres du préréglage ac (spec §8)', () => {
    expect(THEMES.ac.dark).toMatchObject({
      '--page-bg': '#1F1418', '--card': '#2A1B21', '--text': '#F3E6E9', '--accent-text': '#FF6B85',
      '--accent-dark': '#F3B7C4', '--badge-bg': '#4A2230', '--ok-bg': '#1F3A1A', '--ok-text': '#A8D890',
      '--logo': '#CB8593', '--card-border': '#4A2F38', '--grid-line': '#2B1C22', '--accent': '#DD0033',
    });
  });
  it('écarts des autres préréglages en clair', () => {
    expect(THEMES.a.light).toMatchObject({ '--page-bg': '#FFFFFF', '--grid-line': '#EBD2D8', '--logo': '#CB8593' });
    expect(THEMES.b.light).toMatchObject({ '--page-bg': '#FFFFFF', '--grid-line': 'transparent', '--card-border': '#E6E6E6', '--logo': '#CB8593' });
    expect(THEMES.c.light['--grid-line']).toBe('transparent');
    expect(THEMES.b.dark['--grid-line']).toBe('transparent');
    expect(THEMES.c.dark['--grid-line']).toBe('transparent');
    expect(THEMES.a.dark['--grid-line']).toBe('#2B1C22');
  });
});

describe('contrastRatio', () => {
  it('blanc sur #DD0033 vaut 5,09', () => expect(contrastRatio('#FFFFFF', '#DD0033')).toBeCloseTo(5.09, 2));
  it('noir sur blanc vaut 21', () => expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1));
});

describe('resolveMode', () => {
  it('auto suit le système, clair et sombre le forcent', () => {
    expect(resolveMode('auto', true)).toBe('dark');
    expect(resolveMode('auto', false)).toBe('light');
    expect(resolveMode('clair', true)).toBe('light');
    expect(resolveMode('sombre', false)).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('pose les variables et data-mode', () => {
    const root = document.createElement('div');
    applyTheme(root, { theme: 'ac', mode: 'sombre', overrides: {} }, false);
    expect(root.style.getPropertyValue('--page-bg')).toBe('#1F1418');
    expect(root.getAttribute('data-mode')).toBe('dark');
    applyTheme(root, { theme: 'ac', mode: 'clair', overrides: {} }, true);
    expect(root.getAttribute('data-mode')).toBe('light');
  });
  it('une surcharge claire ne touche pas le mode sombre', () => {
    const root = document.createElement('div');
    const overrides = { light: { '--accent': '#112233' } };
    applyTheme(root, { theme: 'ac', mode: 'clair', overrides }, false);
    expect(root.style.getPropertyValue('--accent')).toBe('#112233');
    applyTheme(root, { theme: 'ac', mode: 'sombre', overrides }, false);
    expect(root.style.getPropertyValue('--accent')).toBe('#DD0033');
  });
});

describe('contrastWarnings', () => {
  it("signale --accent-text quand il a moins de 3:1 sur le fond", () => {
    const t: Tokens = { ...THEMES.ac.light, '--accent-text': '#F8E8EC' };
    expect(contrastWarnings(t)).toEqual(['--accent-text']);
  });
});

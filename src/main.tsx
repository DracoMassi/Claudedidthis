import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import 'katex/dist/katex.min.css';
import './theme/theme.css';
import './theme/apple.css';
import App from './App';
import { getSettings } from './lib/storage/settings';
import { GithubRepo } from './lib/github/repo';
import { loadFonts } from './lib/github/fonts';
import { applyTheme } from './theme/themes';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const appliquer = () => {
  const s = getSettings();
  applyTheme(document.documentElement, { theme: s.theme, mode: s.mode, overrides: s.themeOverrides }, mq.matches);
};
appliquer();
mq.addEventListener('change', appliquer);
window.addEventListener('sequentia-settings-changed', appliquer);

const cfg = getSettings();
if (cfg.githubToken && cfg.owner && cfg.repo) void loadFonts(new GithubRepo(cfg.owner, cfg.repo, cfg.githubToken));

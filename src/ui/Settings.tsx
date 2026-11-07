import { useState } from 'react';
import ThemeSettings from './ThemeSettings';
import { clearKeys, getSettings, saveSettings, type Settings as S } from '../lib/storage/settings';

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

type TestResult = {
  status: TestStatus;
  message: string;
};

async function testGithub(s: S): Promise<TestResult> {
  if (!s.githubToken) return { status: 'error', message: 'Indique un jeton GitHub avant de tester' };
  if (!s.owner || !s.repo) return { status: 'error', message: 'Renseigne le propriétaire et le nom du dépôt' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`, {
      headers: { Authorization: `Bearer ${s.githubToken}`, Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (r.ok) return { status: 'success', message: 'GitHub : connexion réussie au dépôt ' + s.owner + '/' + s.repo };
    if (r.status === 401) return { status: 'error', message: 'Jeton GitHub refusé ou expiré (401). Vérifie tes droits.' };
    if (r.status === 404) return { status: 'error', message: `Dépôt « ${s.owner}/${s.repo} » introuvable (404), ou jeton sans accès à ce dépôt.` };
    return { status: 'error', message: `GitHub a répondu avec le statut ${r.status}.` };
  } catch (err: any) {
    if (err?.name === 'AbortError') return { status: 'error', message: "Délai dépassé (10s) : GitHub n'a pas répondu à temps." };
    return { status: 'error', message: "Impossible de joindre GitHub. Vérifie ta connexion Internet." };
  }
}

async function testGemini(s: S): Promise<TestResult> {
  if (!s.geminiKey) return { status: 'error', message: 'Indique ta clé API Gemini avant de tester' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(s.geminiKey)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (r.ok) return { status: 'success', message: 'Gemini : clé API valide et connexion confirmée' };
    if (r.status === 400 || r.status === 403) return { status: 'error', message: 'Clé Gemini refusée ou invalide (code ' + r.status + ').' };
    return { status: 'error', message: `Gemini a répondu avec le statut ${r.status}.` };
  } catch (err: any) {
    if (err?.name === 'AbortError') return { status: 'error', message: "Délai dépassé (10s) : Gemini n'a pas répondu à temps." };
    return { status: 'error', message: "Impossible de joindre Gemini. Vérifie ta connexion Internet." };
  }
}

export default function Settings() {
  const [s, setS] = useState<S>(getSettings());
  const [ghResult, setGhResult] = useState<TestResult | null>(null);
  const [gemResult, setGemResult] = useState<TestResult | null>(null);
  const [infoMsg, setInfoMsg] = useState('');

  const set = <K extends keyof S>(k: K, v: S[K]) => {
    saveSettings({ [k]: v } as Partial<S>);
    setS(getSettings());
    window.dispatchEvent(new Event('sequentia-settings-changed'));
  };

  const handleTestGithub = async () => {
    setGhResult({ status: 'loading', message: 'Test de connexion à GitHub en cours…' });
    const res = await testGithub(s);
    setGhResult(res);
  };

  const handleTestGemini = async () => {
    setGemResult({ status: 'loading', message: 'Test de connexion à Gemini en cours…' });
    const res = await testGemini(s);
    setGemResult(res);
  };

  const text = (k: 'geminiKey' | 'githubToken' | 'owner' | 'repo' | 'model', label: string, hint?: string, secret = false) => (
    <label style={{ display: 'block', margin: '12px 0' }}>
      <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{label}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--accent-dark)', display: 'block', marginBottom: 4 }}>{hint}</span>}
      <input
        style={{ display: 'block', width: '100%', padding: '8px 10px' }}
        type={secret ? 'password' : 'text'}
        autoComplete="off"
        value={s[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );

  const num = (k: 'maxPerMinute' | 'maxPerDay' | 'lotPages', label: string, hint?: string) => (
    <label style={{ display: 'block', margin: '12px 0' }}>
      <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{label}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--accent-dark)', display: 'block', marginBottom: 4 }}>{hint}</span>}
      <input
        style={{ display: 'block', width: 140, padding: '8px 10px' }}
        type="number"
        min={1}
        value={s[k]}
        onChange={(e) => set(k, Math.max(1, Number(e.target.value) || 1))}
      />
    </label>
  );

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, color: 'var(--accent-text)' }}>🔑 Identifiants & API</h3>

        {text('geminiKey', 'Clé API Gemini', 'Nécessaire pour la génération de fiches et la transcription de cours.', true)}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={gemResult?.status === 'loading'} onClick={() => void handleTestGemini()}>
            {gemResult?.status === 'loading' ? '⏳ Vérification…' : '🔍 Tester la clé Gemini'}
          </button>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
            Obtenir une clé Gemini gratuite sur Google AI Studio ↗
          </a>
        </div>
        {gemResult && (
          <div className={`banner banner-${gemResult.status === 'success' ? 'success' : gemResult.status === 'loading' ? 'info' : 'error'}`} style={{ margin: '6px 0 16px' }}>
            <span className="banner-icon">{gemResult.status === 'success' ? '✓' : gemResult.status === 'loading' ? '⏳' : '❌'}</span>
            <div className="banner-body">{gemResult.message}</div>
          </div>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--card-border)', margin: '16px 0' }} />

        {text('githubToken', 'Jeton d\'accès personnel GitHub', 'Doit avoir l\'accès en lecture/écriture au dépôt des fiches (scope "repo").', true)}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {text('owner', 'Propriétaire du dépôt (user ou org)')}
          {text('repo', 'Nom du dépôt (ex: Fiches)')}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={ghResult?.status === 'loading'} onClick={() => void handleTestGithub()}>
            {ghResult?.status === 'loading' ? '⏳ Vérification…' : '🔍 Tester la connexion GitHub'}
          </button>
          <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
            Créer un jeton sur GitHub ↗
          </a>
        </div>
        {ghResult && (
          <div className={`banner banner-${ghResult.status === 'success' ? 'success' : ghResult.status === 'loading' ? 'info' : 'error'}`} style={{ margin: '6px 0 16px' }}>
            <span className="banner-icon">{ghResult.status === 'success' ? '✓' : ghResult.status === 'loading' ? '⏳' : '❌'}</span>
            <div className="banner-body">{ghResult.message}</div>
          </div>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--card-border)', margin: '16px 0' }} />

        <h3 style={{ color: 'var(--accent-text)', marginBottom: 4 }}>⚙️ Paramètres de génération</h3>
        {text('model', 'Modèle Gemini', 'Par défaut : gemini-3.8-flash (rapide et précis)')}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {num('maxPerMinute', 'Requêtes / minute', 'Plafond local anti-emballement')}
          {num('maxPerDay', 'Requêtes / jour', 'Plafond quotidien gratuit')}
          {num('lotPages', 'Pages par lot', 'Découpage des PDF lors de l\'import')}
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline-danger btn-sm" onClick={() => { clearKeys(); setS(getSettings()); setInfoMsg('Toutes les clés ont été effacées.'); setGhResult(null); setGemResult(null); }}>
            🗑 Effacer les clés enregistrées
          </button>
          {infoMsg && <span style={{ fontSize: 13, color: 'var(--accent-dark)' }}>{infoMsg}</span>}
        </div>
      </div>

      <ThemeSettings />
    </>
  );
}


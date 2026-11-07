import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestBudget } from '../lib/gemini/budget';
import { buildPrompt } from '../lib/generate/context';
import { generateFiche, type GenerateStep } from '../lib/generate/loop';
import { loadSources } from '../lib/generate/sources';
import type { GithubRepo } from '../lib/github/repo';
import { AbortedError, AuthError, RateLimitError } from '../lib/errors';
import schema from '../lib/schema/schema.json';
import { slugify } from '../lib/slug';
import { exportDraft, type Db, type Draft } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Brief, Fiche, Problem } from '../lib/types';
import { makeGenerateDeps } from './geminiDeps';
import { messageFor } from './messages';

type Props = {
  repo: GithubRepo | null;
  db: Db | null;
  initialBrief?: Brief | null;
  onOpenDraft: (d: Draft) => void;
  onNavigate?: (entree: string) => void;
};

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const EMPTY = { matiere: 'maths', niveau: 'mpsi', chapitre: '', sujet: '', format: 'fiche', contenu: '', pieges: '', exemples: '', nbQcm: 2, exclure: '', consignes: '' };
type Form = typeof EMPTY;

const toBrief = (f: Form): Brief => ({
  id: slugify(f.sujet) || 'brouillon', matiere: f.matiere, niveau: f.niveau, chapitre: f.chapitre, sujet: f.sujet,
  format: f.format === 'post' ? 'post' : 'fiche', contenu_obligatoire: lines(f.contenu), pieges: lines(f.pieges),
  exemples: lines(f.exemples), nb_qcm: f.nbQcm, exclure: lines(f.exclure), ...(f.consignes ? { consignes: f.consignes } : {}),
});
const fromBrief = (b: Brief): Form => ({
  matiere: b.matiere, niveau: b.niveau, chapitre: b.chapitre, sujet: b.sujet, format: b.format ?? 'fiche',
  contenu: (b.contenu_obligatoire ?? []).join('\n'), pieges: (b.pieges ?? []).join('\n'), exemples: (b.exemples ?? []).join('\n'),
  nbQcm: b.nb_qcm ?? 2, exclure: (b.exclure ?? []).join('\n'), consignes: b.consignes ?? '',
});

export function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export default function Generate({ repo, db, initialBrief, onOpenDraft, onNavigate }: Props) {
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [tour, setTour] = useState(0);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'error' | 'warning' | 'success' | 'info'>('info');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [used, setUsed] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (db) setDrafts(await db.listDrafts());
    const s = getSettings();
    const u = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget').used();
    setUsed(`${u.day}/${u.limit}`);
  }, [db]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (initialBrief) setF(fromBrief(initialBrief)); }, [initialBrief]);

  // Compte à rebours automatique pour RateLimit
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => (c !== null && c > 1 ? c - 1 : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const importBrief = async (file: File | undefined) => {
    if (!file) return;
    try {
      setF(fromBrief(JSON.parse(await file.text()) as Brief));
      setMsg('Brief importé avec succès');
      setMsgType('success');
    } catch {
      setMsg("Ce fichier n'est pas un brief JSON valide");
      setMsgType('error');
    }
  };

  const cancelGeneration = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setCurrentStep('Annulation en cours…');
    }
  };

  const stepDesc = (s: GenerateStep): string => {
    switch (s.phase) {
      case 'llm': return `Tour ${s.tour}/4 : Rédaction de la fiche par Gemini…`;
      case 'validate': return `Tour ${s.tour}/4 : Vérification de la conformité du schéma…`;
      case 'lint': return `Tour ${s.tour}/4 : Analyse des formules et règles éditoriales…`;
      case 'render': return `Tour ${s.tour}/4 : Mesure des pages et calcul des débordements…`;
    }
  };

  const run = async () => {
    const s = getSettings();
    if (!s.geminiKey) {
      setMsg(messageFor(new AuthError()));
      setMsgType('error');
      return;
    }
    if (!repo || !db) {
      setMsg('Ajoute ton jeton GitHub, le propriétaire et le nom du dépôt dans Réglages');
      setMsgType('warning');
      return;
    }
    if (!f.sujet.trim() || !f.chapitre.trim()) {
      setMsg('Renseigne au moins le chapitre et le sujet');
      setMsgType('warning');
      return;
    }

    setBusy(true);
    setMsg('');
    setProblems([]);
    setTour(0);
    setCurrentStep('Préparation : chargement des sources (charte, cours, exemples)…');
    setCountdown(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await document.fonts?.ready;
      const brief = toBrief(f);

      let src;
      try {
        src = await loadSources(repo, db, brief);
      } catch (e) {
        setMsg(messageFor(e, { source: 'github' }));
        setMsgType('error');
        return;
      }

      if (controller.signal.aborted) throw new AbortedError();

      const prompt = buildPrompt({ charte: src.charte, schema: schema as object, examples: src.examples, sections: src.sections, brief });
      const deps = makeGenerateDeps(s, prompt.system, setTour, { signal: controller.signal });

      const result = await generateFiche(brief, prompt, deps, 4, {
        signal: controller.signal,
        onStep: (st) => setCurrentStep(stepDesc(st)),
      });

      const fiche: Fiche | null = result.fiche
        ? { ...result.fiche, meta: { ...result.fiche.meta, statut: 'a_verifier', brief, format: result.fiche.meta.format ?? brief.format ?? 'fiche' } }
        : null;

      const draft: Draft = { id: brief.id, fiche, raw: result.last, brief, problems: result.problems, updatedAt: Date.now() };
      await db.putDraft(draft);
      setProblems(result.problems);

      if (result.error) {
        if (result.error instanceof RateLimitError) {
          setCountdown(result.error.retryAfterSec);
        }
        setMsg(messageFor(result.error));
        setMsgType(result.error instanceof AbortedError ? 'info' : 'error');
      } else if (!result.ok) {
        setMsg("La fiche n'a pas passé tous les contrôles. Le dernier essai est gardé dans les brouillons");
        setMsgType('warning');
      } else {
        setMsg(`Brouillon prêt après ${result.tours} tour${result.tours > 1 ? 's' : ''}`);
        setMsgType('success');
      }
      await refresh();
    } catch (e) {
      if (e instanceof RateLimitError) {
        setCountdown(e.retryAfterSec);
      }
      setMsg(messageFor(e));
      setMsgType(e instanceof AbortedError ? 'info' : 'error');
    } finally {
      setBusy(false);
      setCurrentStep('');
      abortRef.current = null;
    }
  };

  const navSettings = () => {
    if (onNavigate) onNavigate('Réglages');
    else window.dispatchEvent(new CustomEvent('sequentia-navigate', { detail: 'Réglages' }));
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
            📥 Importer un brief (.json)
            <input type="file" accept="application/json,.json" hidden onChange={(e) => void importBrief(e.target.files?.[0])} />
          </label>
          <span className="badge" title="Plafond local de requêtes">
            Quota du jour : <b>{used}</b>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Matière</span>
            <select style={{ width: '100%' }} value={f.matiere} onChange={(e) => set('matiere', e.target.value)} disabled={busy}>
              {['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>

          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Niveau</span>
            <select style={{ width: '100%' }} value={f.niveau} onChange={(e) => set('niveau', e.target.value)} disabled={busy}>
              <option value="mpsi">MPSI / Prépa</option>
              <option value="terminale">Terminale</option>
            </select>
          </label>

          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Format</span>
            <select style={{ width: '100%' }} value={f.format} onChange={(e) => set('format', e.target.value)} disabled={busy}>
              <option value="fiche">Fiche A4 (impression)</option>
              <option value="post">Post 4:5 (Instagram)</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 10 }}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Chapitre *</span>
            <input style={{ width: '100%' }} placeholder="Ex : Continuité et dérivabilité" value={f.chapitre} onChange={(e) => set('chapitre', e.target.value)} disabled={busy} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Sujet de la fiche *</span>
            <input style={{ width: '100%' }} placeholder="Ex : Théorème des valeurs intermédiaires" value={f.sujet} onChange={(e) => set('sujet', e.target.value)} disabled={busy} />
          </label>
        </div>

        <label style={{ display: 'block', marginTop: 10 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Contenu obligatoire (un point par ligne)</span>
          <textarea style={{ width: '100%' }} rows={3} placeholder="Ex : Énoncé du TVI&#10;Corollaire avec stricte monotonie&#10;Exemple d'application" value={f.contenu} onChange={(e) => set('contenu', e.target.value)} disabled={busy} />
        </label>

        {/* Options avancées pliables */}
        <details className="card-details" style={{ marginTop: 12 }}>
          <summary>⚙ Options avancées (pièges, QCM, exclusions, consignes)</summary>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Pièges à signaler</span>
              <textarea style={{ width: '100%' }} rows={2} placeholder="Ex : Oublier l'hypothèse de continuité" value={f.pieges} onChange={(e) => set('pieges', e.target.value)} disabled={busy} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Exemples souhaités</span>
              <textarea style={{ width: '100%' }} rows={2} placeholder="Ex : Polynôme de degré 3 sans racine évidente" value={f.exemples} onChange={(e) => set('exemples', e.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Nombre de questions QCM</span>
                <input style={{ width: 100 }} type="number" min={0} max={10} value={f.nbQcm} onChange={(e) => set('nbQcm', Math.max(0, Number(e.target.value) || 0))} disabled={busy} />
              </label>
            </div>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>À exclure de la fiche</span>
              <textarea style={{ width: '100%' }} rows={2} placeholder="Ex : Démonstration topologique complète" value={f.exclure} onChange={(e) => set('exclure', e.target.value)} disabled={busy} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Consignes spécifiques</span>
              <textarea style={{ width: '100%' }} rows={2} placeholder="Ex : Privilégier les schémas mentaux et la clarté" value={f.consignes} onChange={(e) => set('consignes', e.target.value)} disabled={busy} />
            </label>
          </div>
        </details>

        {/* Barre d'action */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          {!busy ? (
            <button className="btn btn-primary" onClick={() => void run()}>
              ✦ Générer la fiche
            </button>
          ) : (
            <button className="btn btn-danger" onClick={cancelGeneration}>
              ⏹ Annuler la génération
            </button>
          )}

          {countdown !== null && countdown > 0 && (
            <span className="countdown-pill">
              ⏳ Attente quota : <b>{countdown}s</b>
            </span>
          )}
        </div>
      </div>

      {/* Progression en temps réel */}
      {busy && (
        <div className="stepper-box">
          <div className="stepper-header">
            <span className="stepper-title">
              <span className="spinner" style={{ marginRight: 8 }} />
              Génération en cours…
            </span>
            <span className="badge">Tour {tour} / 4</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>
            {currentStep || 'Traitement de la requête…'}
          </p>
        </div>
      )}

      {/* Bannière de message claire avec diagnostics */}
      {msg && (
        <div className={`banner banner-${msgType}`} role="status">
          <span className="banner-icon">
            {msgType === 'error' && '❌'}
            {msgType === 'warning' && '⚠️'}
            {msgType === 'success' && '✓'}
            {msgType === 'info' && 'ℹ️'}
          </span>
          <div className="banner-body">
            <div className="banner-title">
              {msgType === 'error' && 'Échec de la requête'}
              {msgType === 'warning' && 'Attention requise'}
              {msgType === 'success' && 'Opération réussie'}
              {msgType === 'info' && 'Information'}
            </div>
            <div>{msg}</div>
            {msg.includes('Réglages') && (
              <div className="banner-actions">
                <button className="btn btn-secondary btn-sm" onClick={navSettings}>
                  ⚙ Aller aux Réglages
                </button>
              </div>
            )}
            {msgType === 'error' && !busy && countdown === null && (
              <div className="banner-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void run()}>
                  🔄 Réessayer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Problèmes détectés */}
      {problems.length > 0 && (
        <div className="card" style={{ borderColor: '#F98080', marginBottom: 16 }}>
          <b style={{ color: '#C5221F', display: 'block', marginBottom: 6 }}>
            Contrôles non validés lors de la génération ({problems.length}) :
          </b>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {problems.map((p, i) => (
              <li key={i} style={{ fontSize: 13, margin: '4px 0' }}>
                <span className="badge" style={{ marginRight: 6 }}>{p.code}</span>
                {p.path ? <code>{p.path}</code> : ''} : {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Brouillons */}
      <h2 className="titre" style={{ fontSize: 24, marginTop: 24 }}>Brouillons récents</h2>
      {drafts.length === 0 && <div className="card">Aucun brouillon enregistré.</div>}
      {drafts.map((d) => (
        <div key={d.id} className="card" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <b>{d.fiche?.meta.titre ?? d.id}</b>
            <div style={{ fontSize: 12, color: 'var(--accent-dark)', marginTop: 2 }}>
              {d.brief?.matiere} · {d.brief?.niveau} · {new Date(d.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {d.fiche ? (
              <span className="badge ok">✓ prêt pour relecture</span>
            ) : (
              <span className="badge" style={{ background: '#FDE8E8', color: '#9B1C1C' }}>dernier essai</span>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => onOpenDraft(d)}>
              🔍 Relire
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => downloadText(`${d.id}.json`, exportDraft(d))}>
              💾 JSON
            </button>
            <button className="btn btn-outline-danger btn-sm" onClick={async () => { await db?.deleteDraft(d.id); await refresh(); }}>
              🗑 Supprimer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}


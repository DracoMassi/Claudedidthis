import { useEffect, useRef, useState } from 'react';
import { AbortedError, ConflictError } from '../lib/errors';
import { extractJson } from '../lib/gemini/json';
import { buildPrompt } from '../lib/generate/context';
import { loadSources } from '../lib/generate/sources';
import type { GithubRepo } from '../lib/github/repo';
import { canValidate, parseChecklist } from '../lib/relire/checklist';
import { correctFiche, ficheSavePath, validerFiche } from '../lib/relire/valider';
import { renderFiche } from '../lib/render/renderFiche';
import schema from '../lib/schema/schema.json';
import { lintLatex } from '../lib/schema/lint';
import { validateFiche } from '../lib/schema/validate';
import type { Db, Draft } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Block, Brief, Fiche, Problem } from '../lib/types';
import { makeGenerateDeps, renderOffscreen } from './geminiDeps';
import { messageFor } from './messages';

type Props = { repo: GithubRepo | null; db: Db | null; draft: Draft | null; path: string | null; onNavigate?: (tab: string) => void };
type Checks = { schema: Problem[]; lint: Problem[]; katex: string[]; overflow: number[] };

function FieldEditor({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const box = { style: { display: 'block', width: '100%', padding: 8 } };
  if (typeof value === 'string') return <label style={{ display: 'block', margin: '8px 0' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{label}</span><textarea {...box} rows={Math.min(8, 1 + Math.floor(value.length / 60))} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
  if (typeof value === 'number') return <label style={{ display: 'block', margin: '8px 0' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{label}</span><input {...box} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string'))
    return <label style={{ display: 'block', margin: '8px 0' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{label} (une ligne par élément)</span><textarea {...box} rows={Math.min(8, value.length + 1)} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} /></label>;
  return <label style={{ display: 'block', margin: '8px 0' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>{label} (JSON)</span><textarea {...box} rows={5} defaultValue={JSON.stringify(value, null, 2)} onBlur={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* inchangé */ } }} /></label>;
}

export default function Review({ repo, db, draft, path, onNavigate }: Props) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [baseSha, setBaseSha] = useState<string | undefined>();
  const [items, setItems] = useState<string[]>(parseChecklist(''));
  const [checked, setChecked] = useState<boolean[]>([]);
  const [checks, setChecks] = useState<Checks>({ schema: [], lint: [], katex: [], overflow: [] });
  const [raw, setRaw] = useState('');
  const [rawMsg, setRawMsg] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'error' | 'warning' | 'success' | 'info'>('info');
  const [conflict, setConflict] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setChecked(items.map(() => false)); }, [items]);
  useEffect(() => {
    if (!repo) return;
    repo.readFile('charte.md').then((r) => setItems(parseChecklist(r.content)), () => setItems(parseChecklist('')));
  }, [repo]);

  useEffect(() => {
    setMsg(''); setConflict(null); setBaseSha(undefined);
    if (draft) { setFiche(draft.fiche); setRaw(draft.fiche ? '' : draft.raw ?? ''); return; }
    if (path && repo) {
      repo.readFile(path).then((r) => { setFiche(JSON.parse(r.content) as Fiche); setBaseSha(r.sha); }, (e) => {
        setMsg(messageFor(e, { source: 'github' }));
        setMsgType('error');
      });
    } else setFiche(null);
  }, [draft, path, repo]);

  useEffect(() => {
    if (!fiche) return;
    // Contrôles mesurés hors écran : l'aperçu peut être masqué (onglets en portrait) et un élément masqué n'a pas de hauteur.
    const mesure = renderOffscreen(fiche);
    setChecks({ schema: validateFiche(fiche), lint: lintLatex(fiche), katex: mesure.katexErrors, overflow: mesure.overflow });
    if (preview.current) renderFiche(preview.current, fiche);
  }, [fiche]);

  const updateBlock = (i: number, j: number, key: string, value: unknown) =>
    setFiche((f) => f && { ...f, pages: f.pages.map((p, pi) => (pi !== i ? p : { ...p, blocks: p.blocks.map((b, bj) => (bj !== j ? b : { ...b, [key]: value })) })) });

  const bloquants = checks.schema.length + checks.lint.length + checks.katex.length;
  const peutValider = !!repo && !!fiche && canValidate(checked) && bloquants === 0;

  const cancelAction = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setMsg('Opération annulée');
      setMsgType('info');
    }
  };

  const valider = async (force = false) => {
    if (!repo || !fiche) return;
    setBusy(true); setMsg(''); setBusyAction('Validation sur GitHub en cours…');
    try {
      const saved = await validerFiche(repo, fiche, { baseSha, force });
      if (draft && db) await db.deleteDraft(draft.id);
      setBaseSha((await repo.readFile(saved)).sha);
      setConflict(null);
      setMsg(`Fiche validée et enregistrée : ${saved}`);
      setMsgType('success');
    } catch (e) {
      if (e instanceof ConflictError) {
        try { setConflict((await repo.readFile(ficheSavePath(fiche))).content); } catch { setConflict('(version distante introuvable)'); }
        setMsg(messageFor(e));
        setMsgType('warning');
      } else {
        setMsg(messageFor(e, { source: 'github', offline: !navigator.onLine }));
        setMsgType('error');
      }
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  const corriger = async () => {
    const s = getSettings();
    if (!fiche || !repo || !db || !instruction.trim()) return;
    if (!s.geminiKey) {
      setMsg('Ajoute ta clé Gemini dans Réglages');
      setMsgType('error');
      return;
    }

    setBusy(true);
    setMsg('');
    setBusyAction('Correction en cours avec Gemini…');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const brief: Brief = fiche.meta.brief ?? { id: 'correction', matiere: fiche.meta.matiere, niveau: fiche.meta.niveau, chapitre: fiche.meta.chapitre, sujet: fiche.meta.titre };
      const src = await loadSources(repo, db, brief);
      const prompt = buildPrompt({ charte: src.charte, schema: schema as object, examples: src.examples, sections: src.sections, brief });
      const deps = makeGenerateDeps(s, prompt.system, () => undefined, { signal: controller.signal });

      const r = await correctFiche(fiche, instruction, prompt, deps);
      if (r.ok && r.fiche) {
        setFiche({ ...r.fiche, meta: { ...r.fiche.meta, brief: fiche.meta.brief ?? r.fiche.meta.brief, statut: fiche.meta.statut } });
        setMsg('Correction appliquée. Vérifie la fiche avant de valider');
        setMsgType('success');
        setInstruction('');
      } else if (r.error instanceof AbortedError) {
        setMsg('Correction annulée');
        setMsgType('info');
      } else {
        setMsg(r.error ? messageFor(r.error) : `La correction n'a pas passé les contrôles : ${r.problems.map((p) => p.message).join(' ; ')}`);
        setMsgType('warning');
      }
    } catch (e) {
      setMsg(messageFor(e));
      setMsgType(e instanceof AbortedError ? 'info' : 'error');
    } finally {
      setBusy(false);
      setBusyAction('');
      abortRef.current = null;
    }
  };

  const appliquerRaw = (text: string) => {
    try {
      const d = extractJson(text) as Fiche;
      if (!d || !Array.isArray(d.pages)) throw new Error('pas une fiche');
      setFiche(d); setRawMsg('');
      setMsg('JSON appliqué avec succès');
      setMsgType('success');
    } catch {
      setRawMsg('JSON invalide : impossible de l’appliquer');
    }
  };

  const navSettings = () => {
    if (onNavigate) onNavigate('Réglages');
    else window.dispatchEvent(new CustomEvent('sequentia-navigate', { detail: 'Réglages' }));
  };

  if (!draft && !path) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
        <h3 style={{ marginTop: 0 }}>Aucune fiche sélectionnée pour la relecture</h3>
        <p style={{ color: 'var(--accent-dark)' }}>
          Choisis un brouillon dans l'onglet <b>Générer</b>, ou une fiche dans la <b>Bibliothèque</b> (bouton « Modifier »).
        </p>
      </div>
    );
  }

  if (!fiche) {
    return (
      <div className="card">
        {msg && (
          <div className={`banner banner-${msgType}`} role="alert">
            <span className="banner-icon">{msgType === 'error' ? '❌' : '⚠️'}</span>
            <div className="banner-body">{msg}</div>
          </div>
        )}
        {draft && (
          <>
            <p style={{ fontWeight: 600 }}>Le dernier essai n'a pas produit de fiche JSON valide. Corrige le texte ci-dessous puis applique-le :</p>
            {draft.problems.length > 0 && (
              <div className="banner banner-error">
                <span className="banner-icon">❌</span>
                <div className="banner-body">
                  <b>Problèmes relevés :</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {draft.problems.map((p, i) => <li key={i}>{p.code} : {p.message}</li>)}
                  </ul>
                </div>
              </div>
            )}
            <textarea style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} rows={14} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => appliquerRaw(raw)}>
              ✓ Appliquer le JSON
            </button>
            {rawMsg && <p role="alert" style={{ color: '#C5221F', fontWeight: 600 }}>{rawMsg}</p>}
          </>
        )}
      </div>
    );
  }

  const etat = (ok: boolean) => (ok ? '✓ OK' : '✗ Erreur');
  const checkedCount = checked.filter(Boolean).length;

  return (
    <div>
      <div className="tabs-review" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className={`btn ${tab === 'edit' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>
          ✏️ Édition des champs
        </button>
        <button className={`btn ${tab === 'preview' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
          👁 Aperçu visuel
        </button>
      </div>

      {/* Tableau de bord des contrôles qualité */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <b style={{ color: 'var(--accent-text)', fontSize: 15 }}>Diagnostic qualité de la fiche :</b>
          <span className="badge">
            {bloquants === 0 ? '✓ Aucun problème bloquant' : `⚠️ ${bloquants} point(s) bloquant(s)`}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 13 }}>
          <div style={{ padding: '6px 10px', borderRadius: 8, background: checks.schema.length === 0 ? 'var(--ok-bg)' : '#FDE8E8', color: checks.schema.length === 0 ? 'var(--ok-text)' : '#9B1C1C' }}>
            <b>Schéma :</b> {etat(checks.schema.length === 0)}
          </div>
          <div style={{ padding: '6px 10px', borderRadius: 8, background: checks.lint.length === 0 ? 'var(--ok-bg)' : '#FEFCE8', color: checks.lint.length === 0 ? 'var(--ok-text)' : '#713F12' }}>
            <b>Lint éditorial :</b> {etat(checks.lint.length === 0)}
          </div>
          <div style={{ padding: '6px 10px', borderRadius: 8, background: checks.katex.length === 0 ? 'var(--ok-bg)' : '#FDE8E8', color: checks.katex.length === 0 ? 'var(--ok-text)' : '#9B1C1C' }}>
            <b>KaTeX / Maths :</b> {etat(checks.katex.length === 0)}
          </div>
          <div style={{ padding: '6px 10px', borderRadius: 8, background: checks.overflow.length === 0 ? 'var(--ok-bg)' : '#FEFCE8', color: checks.overflow.length === 0 ? 'var(--ok-text)' : '#713F12' }}>
            <b>Gabarit page :</b> {checks.overflow.length === 0 ? '✓ OK' : `Page(s) ${checks.overflow.join(', ')}`}
          </div>
        </div>

        {(checks.schema.length > 0 || checks.lint.length > 0 || checks.katex.length > 0 || checks.overflow.length > 0) && (
          <div style={{ marginTop: 8, fontSize: 13, borderTop: '1px solid var(--card-border)', paddingTop: 6 }}>
            {[...checks.schema, ...checks.lint].map((p, i) => (
              <div key={i} style={{ color: p.code === 'schema' ? '#C5221F' : 'var(--accent-dark)', margin: '2px 0' }}>
                • <b>{p.code}</b> {p.path ? `(${p.path})` : ''} : {p.message}
              </div>
            ))}
            {checks.katex.map((m, i) => (
              <div key={i} style={{ color: '#C5221F', margin: '2px 0' }}>• <b>Formule KaTeX :</b> {m}</div>
            ))}
          </div>
        )}
      </div>

      <div className="review">
        <div className={`pane card${tab === 'edit' ? '' : ' hidden'}`}>
          <h3 style={{ marginTop: 0, color: 'var(--accent-text)' }}>Contenu de la fiche</h3>
          {fiche.pages.map((p, i) => (
            <div key={i} style={{ marginBottom: 16, borderBottom: '1px solid var(--card-border)', paddingBottom: 12 }}>
              <h4 style={{ margin: '8px 0', color: 'var(--accent-dark)' }}>Page {i + 1}</h4>
              <FieldEditor label="Titre de la page" value={p.titre_page ?? ''} onChange={(v) => setFiche((f) => f && { ...f, pages: f.pages.map((q, qi) => (qi === i ? { ...q, titre_page: String(v) } : q)) })} />
              {p.blocks.map((b: Block, j) => (
                <fieldset key={j} style={{ margin: '8px 0', borderRadius: 8, borderColor: 'var(--card-border)' }}>
                  <legend style={{ fontWeight: 600, color: 'var(--accent-dark)' }}>Bloc {b.type}</legend>
                  {Object.entries(b).filter(([k]) => k !== 'type').map(([k, v]) => <FieldEditor key={k} label={k} value={v} onChange={(nv) => updateBlock(i, j, k, nv)} />)}
                </fieldset>
              ))}
            </div>
          ))}

          <details className="card-details">
            <summary>Code JSON source de la fiche</summary>
            <textarea style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginTop: 8 }} rows={12} defaultValue={JSON.stringify(fiche, null, 2)} key={JSON.stringify(fiche).length}
              onBlur={(e) => appliquerRaw(e.target.value)} />
            {rawMsg && <p role="alert" style={{ color: '#C5221F' }}>{rawMsg}</p>}
          </details>
        </div>

        <div className={`pane${tab === 'preview' ? '' : ' hidden'}`}>
          <div ref={preview} style={{ overflow: 'auto', maxWidth: '100%' }} />
        </div>
      </div>

      {/* Validation et consignes */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <b>Checklist de relecture éditoriale</b>
          <span className="badge">{checkedCount} / {items.length} vérifié(s)</span>
        </div>

        <div style={{ display: 'grid', gap: 6, margin: '8px 0' }}>
          {items.map((it, i) => (
            <label key={it} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={checked[i] ?? false} onChange={(e) => setChecked((c) => c.map((x, k) => (k === i ? e.target.checked : x)))} />
              <span>{it}</span>
            </label>
          ))}
        </div>

        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Consigne de révision pour Gemini (ex: « raccourcis le bloc définition ») :
          </span>
          <textarea style={{ width: '100%' }} rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy} placeholder="Tape une consigne spécifique pour corriger cette fiche…" />
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {busy ? (
            <button className="btn btn-danger" onClick={cancelAction}>
              ⏹ Annuler ({busyAction})
            </button>
          ) : (
            <button className="btn btn-secondary" disabled={!instruction.trim()} onClick={() => void corriger()}>
              ✦ Corriger avec Gemini
            </button>
          )}

          <button className="btn btn-primary" disabled={!peutValider || busy} onClick={() => void valider()} style={{ background: peutValider ? 'var(--accent)' : undefined }}>
            ✓ Valider la fiche sur GitHub
          </button>
        </div>

        {!peutValider && (
          <p style={{ fontSize: 13, color: 'var(--accent-dark)', marginTop: 8 }}>
            💡 Le bouton « Valider » s'active dès que toutes les cases de la checklist sont cochées et que schéma, lint et formules KaTeX sont valides.
          </p>
        )}

        {msg && (
          <div className={`banner banner-${msgType}`} role="status" style={{ marginTop: 10 }}>
            <span className="banner-icon">
              {msgType === 'error' && '❌'}
              {msgType === 'warning' && '⚠️'}
              {msgType === 'success' && '✓'}
              {msgType === 'info' && 'ℹ️'}
            </span>
            <div className="banner-body">
              <div>{msg}</div>
              {msg.includes('Réglages') && (
                <div className="banner-actions">
                  <button className="btn btn-secondary btn-sm" onClick={navSettings}>⚙ Réglages</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {conflict !== null && (
        <div className="card" style={{ marginTop: 12, border: '2px solid #C5221F' }}>
          <b style={{ color: '#C5221F', display: 'block', marginBottom: 6 }}>
            ⚠️ Conflit de version : Cette fiche a été modifiée ailleurs depuis son ouverture.
          </b>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><b>Version distante</b><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 200, overflow: 'auto', background: 'var(--page-bg)', padding: 8, borderRadius: 6 }}>{conflict}</pre></div>
            <div><b>Ma version locale</b><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 200, overflow: 'auto', background: 'var(--page-bg)', padding: 8, borderRadius: 6 }}>{JSON.stringify(fiche, null, 2)}</pre></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-danger" onClick={() => void valider(true)}>Écraser la version distante</button>
            <button className="btn btn-secondary" onClick={() => setConflict(null)}>Conserver la version distante</button>
          </div>
        </div>
      )}
    </div>
  );
}


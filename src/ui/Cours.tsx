import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { splitPdf, type Lot } from '../lib/cours/chunk';
import { checkMarkdown, type CoursMeta } from '../lib/cours/checks';
import { renderMarkdownPreview } from '../lib/cours/preview';
import { ImportQueue } from '../lib/cours/queue';
import { saveCours } from '../lib/cours/save';
import { transcribeLot, transcribeWithGemini } from '../lib/cours/transcribe';
import { AbortedError, ConflictError, RateLimitError } from '../lib/errors';
import { RequestBudget } from '../lib/gemini/budget';
import type { GithubRepo } from '../lib/github/repo';
import { slugify } from '../lib/slug';
import type { Db } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Problem } from '../lib/types';
import { messageFor } from './messages';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Meta = Omit<CoursMeta, 'statut'>;
type View = { id: string | null; meta: Meta; md: string };
type Row = { id: string; done: number; total: number; meta?: Meta };

async function renderPdfPage(canvas: HTMLCanvasElement, data: Uint8Array, pageNumber: number): Promise<void> {
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.3 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise;
}

export default function Cours({ repo, db, onNavigate }: { repo: GithubRepo | null; db: Db | null; onNavigate?: (tab: string) => void }) {
  const [meta, setMeta] = useState<Meta>({ matiere: 'maths', niveau: 'mpsi', chapitre: '', source: '' });
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'error' | 'warning' | 'success' | 'info'>('info');
  const [busy, setBusy] = useState(false);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [currentLotIndex, setCurrentLotIndex] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pasted, setPasted] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [page, setPage] = useState(1);
  const [conflict, setConflict] = useState<'a_verifier' | 'verifie' | null>(null);
  const [used, setUsed] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [imgUrl, setImgUrl] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  const queue = useCallback((t?: (l: Lot) => Promise<string>) => new ImportQueue(db as Db, t ?? (async () => '')), [db]);

  const refresh = useCallback(async () => {
    if (!db) return;
    const q = queue();
    const out: Row[] = [];
    for (const id of await q.ids()) out.push({ id, ...(await q.progress(id)), meta: (await db.get(`import-meta:${id}`)) as Meta | undefined });
    setRows(out);
    const s = getSettings();
    const u = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget').used();
    setUsed(`${u.day}/${u.limit}`);
  }, [db, queue]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Compte à rebours automatique
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => (c !== null && c > 1 ? c - 1 : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !db) return;
    const s = getSettings();
    setBusy(true); setMsg('');
    try {
      const arr = [...files];
      const q = queue();
      const images = arr.filter((f) => f.type.startsWith('image/'));
      for (const f of arr.filter((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'))) {
        const buf = await f.arrayBuffer();
        const l = await splitPdf(buf, s.lotPages);
        const id = `${slugify(f.name.replace(/\.pdf$/i, ''))}-${Date.now().toString(36)}`;
        await q.enqueue(id, l);
        await db.put(`import-meta:${id}`, { ...meta, chapitre: meta.chapitre || f.name.replace(/\.pdf$/i, ''), source: `${f.name} (p. 1-${l[l.length - 1].toPage})` });
      }
      if (images.length) {
        const l: Lot[] = [];
        for (const [i, f] of images.entries()) l.push({ index: i, fromPage: i + 1, toPage: i + 1, data: new Uint8Array(await f.arrayBuffer()), mime: f.type });
        const id = `photos-${Date.now().toString(36)}`;
        await q.enqueue(id, l);
        await db.put(`import-meta:${id}`, { ...meta, chapitre: meta.chapitre || 'Photos de cours', source: `${images.length} photo${images.length > 1 ? 's' : ''}` });
      }
      for (const f of arr.filter((x) => /\.(md|tex|txt)$/i.test(x.name))) {
        // Enregistrés sans conversion : pas de transcription, relecture directe.
        setView({ id: null, meta: { ...meta, chapitre: meta.chapitre || f.name.replace(/\.[^.]+$/, ''), source: f.name }, md: await f.text() });
        setLots([]);
      }
      setMsg('Fichiers importés et découpés en lots');
      setMsgType('success');
      await refresh();
    } catch {
      setMsg("Impossible de lire ce fichier. Vérifie que c'est un PDF, une image ou un fichier texte");
      setMsgType('error');
    } finally {
      setBusy(false);
    }
  };

  const cancelTranscription = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setMsg('Interruption demandée…');
      setMsgType('info');
    }
  };

  const run = async (id: string) => {
    const s = getSettings();
    if (!s.geminiKey) {
      setMsg('Ajoute ta clé Gemini dans Réglages');
      setMsgType('error');
      return;
    }
    const budget = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget');
    let last: unknown;
    setBusy(true);
    setActiveImportId(id);
    setCurrentLotIndex(null);
    setMsg('');
    setCountdown(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const q = queue(async (lot) => {
        if (controller.signal.aborted) throw new AbortedError();
        if (!budget.canSend()) {
          last = new RateLimitError(budget.waitSeconds());
          throw last;
        }
        budget.record();
        try {
          return await transcribeLot(lot, {
            llm: (l) => transcribeWithGemini({ key: s.geminiKey, model: s.model, lot: l, signal: controller.signal }),
          });
        } catch (e) {
          last = e;
          throw e;
        }
      });

      const r = await q.run(id, {
        signal: controller.signal,
        onLotStart: (idx) => setCurrentLotIndex(idx),
      });

      if (r === 'done') {
        setMsg('Transcription terminée. Tu peux relire et enregistrer');
        setMsgType('success');
      } else if (controller.signal.aborted) {
        setMsg('Transcription mise en pause. La progression est enregistrée');
        setMsgType('info');
      } else if (last) {
        if (last instanceof RateLimitError) setCountdown(last.retryAfterSec);
        setMsg(`${messageFor(last)}. La progression est gardée`);
        setMsgType('warning');
      } else {
        setMsg('En pause. La progression est gardée');
        setMsgType('info');
      }
    } catch (e) {
      if (e instanceof RateLimitError) setCountdown(e.retryAfterSec);
      setMsg(messageFor(e));
      setMsgType(e instanceof AbortedError ? 'info' : 'error');
    } finally {
      setBusy(false);
      setActiveImportId(null);
      setCurrentLotIndex(null);
      abortRef.current = null;
      await refresh();
    }
  };

  const openReview = async (id: string) => {
    if (!db) return;
    const q = queue();
    setView({ id, meta: ((await db.get(`import-meta:${id}`)) as Meta | undefined) ?? meta, md: await q.markdown(id) });
    setLots(await q.lots(id)); setPage(1); setConflict(null);
  };

  const total = lots.length ? lots[lots.length - 1].toPage : 0;
  const lotOf = lots.find((l) => page >= l.fromPage && page <= l.toPage);

  useEffect(() => {
    if (!view || !preview.current) return;
    const r = renderMarkdownPreview(preview.current, view.md);
    setProblems([...checkMarkdown(view.md).filter((p) => p.code !== 'katex'), ...r.katexErrors.map((message): Problem => ({ code: 'katex', message }))]);
  }, [view]);

  useEffect(() => {
    setImgUrl('');
    if (!lotOf) return;
    if (lotOf.mime?.startsWith('image/')) {
      const u = URL.createObjectURL(new Blob([lotOf.data.slice()], { type: lotOf.mime }));
      setImgUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (canvas.current) void renderPdfPage(canvas.current, lotOf.data, page - lotOf.fromPage + 1).catch(() => {
      setMsg("Impossible d'afficher la page source");
      setMsgType('warning');
    });
  }, [lotOf, page]);

  const save = async (statut: 'a_verifier' | 'verifie', force = false) => {
    if (!repo || !view) return;
    setBusy(true); setMsg('');
    try {
      const path = await saveCours(repo, { ...view.meta, statut }, view.md, { force });
      if (view.id && db) { await queue().remove(view.id); await refresh(); }
      setConflict(null);
      setMsg(`Cours enregistré : ${path} (${statut === 'verifie' ? 'vérifié' : 'à vérifier'})`);
      setMsgType('success');
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflict(statut);
        setMsg('Ce cours existe déjà. Écraser ou annuler');
        setMsgType('warning');
      } else {
        setMsg(messageFor(e, { source: 'github', offline: !navigator.onLine }));
        setMsgType('error');
      }
    } finally {
      setBusy(false);
    }
  };

  const navSettings = () => {
    if (onNavigate) onNavigate('Réglages');
    else window.dispatchEvent(new CustomEvent('sequentia-navigate', { detail: 'Réglages' }));
  };

  if (!db) return <div className="card">Chargement de la base locale…</div>;

  if (view) {
    return (
      <div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Matière</span>
              <select style={{ width: '100%' }} value={view.meta.matiere} onChange={(e) => setView({ ...view, meta: { ...view.meta, matiere: e.target.value } })}>
                {['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Chapitre</span>
              <input style={{ width: '100%' }} value={view.meta.chapitre} onChange={(e) => setView({ ...view, meta: { ...view.meta, chapitre: e.target.value } })} />
            </label>
          </div>

          <div style={{ marginTop: 12, padding: 8, background: problems.length === 0 ? 'var(--ok-bg)' : 'var(--badge-bg)', borderRadius: 8 }}>
            {problems.length === 0 ? (
              <span style={{ color: 'var(--ok-text)', fontWeight: 600 }}>✓ Contrôles qualité : tout est au vert</span>
            ) : (
              <div>
                <b style={{ color: 'var(--accent-dark)' }}>{problems.length} point{problems.length > 1 ? 's' : ''} à vérifier :</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {problems.map((p, i) => <li key={i}>{p.message}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="review">
          <div className="pane card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b>Document source</b>
              {total > 0 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>◀ Précédente</button>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{page} / {total}</span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= total} onClick={() => setPage(page + 1)}>Suivante ▶</button>
                </div>
              )}
            </div>
            {imgUrl ? (
              <img src={imgUrl} alt={`Page ${page}`} style={{ maxWidth: '100%', borderRadius: 8 }} />
            ) : lotOf ? (
              <canvas ref={canvas} style={{ maxWidth: '100%', borderRadius: 8 }} />
            ) : (
              <p style={{ color: 'var(--accent-dark)' }}>Pas de page source (texte importé directement).</p>
            )}
          </div>

          <div className="pane card">
            <b>Rendu Markdown formaté</b>
            <div ref={preview} style={{ maxHeight: 440, overflow: 'auto', marginTop: 8 }} />
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <b style={{ display: 'block', marginBottom: 6 }}>Éditeur Markdown :</b>
          <textarea style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} rows={12} value={view.md} onChange={(e) => setView({ ...view, md: e.target.value })} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-secondary" disabled={busy || !repo || !view.meta.chapitre.trim()} onClick={() => void save('a_verifier')}>
              💾 Enregistrer (à vérifier)
            </button>
            <button className="btn btn-primary" disabled={busy || !repo || !view.meta.chapitre.trim() || problems.some((p) => p.code === 'katex')} onClick={() => void save('verifie')}>
              ✓ Valider le cours (vérifié)
            </button>
            <button className="btn btn-secondary" onClick={() => { setView(null); setLots([]); }}>
              Fermer
            </button>
            {conflict && (
              <button className="btn btn-danger" onClick={() => void save(conflict, true)}>
                ⚠️ Écraser le cours existant
              </button>
            )}
          </div>

          {!repo && (
            <div className="banner banner-warning" style={{ marginTop: 10 }}>
              <span className="banner-icon">⚠️</span>
              <div className="banner-body">
                <div>Configure ton jeton GitHub dans les Réglages pour pouvoir enregistrer sur le dépôt.</div>
                <div className="banner-actions">
                  <button className="btn btn-secondary btn-sm" onClick={navSettings}>⚙ Réglages</button>
                </div>
              </div>
            </div>
          )}

          {msg && (
            <div className={`banner banner-${msgType}`} style={{ marginTop: 10 }}>
              <span className="banner-icon">
                {msgType === 'error' && '❌'}
                {msgType === 'warning' && '⚠️'}
                {msgType === 'success' && '✓'}
                {msgType === 'info' && 'ℹ️'}
              </span>
              <div className="banner-body">{msg}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="badge">Quota jour : <b>{used}</b></span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Matière</span>
            <select style={{ width: '100%' }} value={meta.matiere} onChange={(e) => setMeta({ ...meta, matiere: e.target.value })}>
              {['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Niveau</span>
            <select style={{ width: '100%' }} value={meta.niveau} onChange={(e) => setMeta({ ...meta, niveau: e.target.value })}>
              <option value="mpsi">MPSI / Prépa</option>
              <option value="terminale">Terminale</option>
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Chapitre</span>
            <input style={{ width: '100%' }} placeholder="Ex : Intégration sur un segment" value={meta.chapitre} onChange={(e) => setMeta({ ...meta, chapitre: e.target.value })} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            📁 Importer PDF, images, .md, .tex
            <input type="file" multiple accept="application/pdf,image/*,.md,.tex,.txt" hidden onChange={(e) => void onFiles(e.target.files)} />
          </label>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            📷 Prendre des photos de cours
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFiles(e.target.files)} />
          </label>
        </div>

        <details className="card-details" style={{ marginTop: 12 }}>
          <summary>✏️ Ou coller directement des notes de cours</summary>
          <div style={{ marginTop: 8 }}>
            <textarea style={{ width: '100%' }} rows={4} placeholder="Colle ici le texte brut d'un cours…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={!pasted.trim()} onClick={() => { setView({ id: null, meta: { ...meta, chapitre: meta.chapitre || 'Cours collé', source: 'texte collé' }, md: pasted }); setLots([]); }}>
              Utiliser ce texte
            </button>
          </div>
        </details>
      </div>

      {countdown !== null && countdown > 0 && (
        <div className="banner banner-warning">
          <span className="banner-icon">⏳</span>
          <div className="banner-body">
            <b>Quota temporairement atteint :</b> Reprise possible dans <b>{countdown}s</b>.
          </div>
        </div>
      )}

      {msg && (
        <div className={`banner banner-${msgType}`} role="status">
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
                <button className="btn btn-secondary btn-sm" onClick={navSettings}>⚙ Aller aux Réglages</button>
              </div>
            )}
          </div>
        </div>
      )}

      <h2 className="titre" style={{ fontSize: 24, marginTop: 24 }}>Imports en cours</h2>
      {rows.length === 0 && <div className="card">Aucun cours en attente d'import.</div>}
      {rows.map((r) => {
        const isCurrentRunning = busy && activeImportId === r.id;
        const percent = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
        return (
          <div key={r.id} className="card" style={{ marginBottom: 12, borderLeft: isCurrentRunning ? '4px solid var(--accent)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <b>{r.meta?.chapitre ?? r.id}</b>
                <div style={{ fontSize: 12, color: 'var(--accent-dark)', marginTop: 2 }}>
                  {r.meta?.source} · <b>{r.done}/{r.total}</b> lots traités ({percent}%)
                </div>
              </div>
              <span className={`badge ${r.done >= r.total ? 'ok' : ''}`}>
                {r.done >= r.total ? '✓ terminé' : isCurrentRunning ? `⏳ lot ${currentLotIndex !== null ? currentLotIndex + 1 : r.done + 1}/${r.total}` : `${r.total - r.done} lot(s) restant(s)`}
              </span>
            </div>

            <div style={{ margin: '10px 0', background: 'var(--badge-bg)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {isCurrentRunning ? (
                <button className="btn btn-danger btn-sm" onClick={cancelTranscription}>
                  ⏹ Mettre en pause
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" disabled={busy || r.done >= r.total} onClick={() => void run(r.id)}>
                  {r.done === 0 ? '▶ Lancer la transcription' : '▶ Reprendre'}
                </button>
              )}

              <button className="btn btn-secondary btn-sm" disabled={r.done === 0} onClick={() => void openReview(r.id)}>
                🔍 Relire
              </button>

              <button className="btn btn-outline-danger btn-sm" disabled={isCurrentRunning} onClick={async () => { await queue().remove(r.id); await refresh(); }}>
                🗑 Supprimer
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


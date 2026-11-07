import { useEffect, useMemo, useRef, useState } from 'react';
import { printPages } from '../lib/export/pdf';
import { exportPng, isLikelyBlank } from '../lib/export/png';
import type { GithubRepo } from '../lib/github/repo';
import { filterItems, loadIndex, setExemple, type LibraryItem } from '../lib/library/index';
import { renderFiche } from '../lib/render/renderFiche';
import { validateFiche } from '../lib/schema/validate';
import type { Db } from '../lib/storage/db';
import type { Brief, Fiche } from '../lib/types';

type Props = { repo: GithubRepo | null; db: Db | null; onEdit?: (path: string) => void; onRedo?: (brief: Brief) => void };

export default function Library({ repo, db, onEdit, onRedo }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'error' | 'warning' | 'success' | 'info'>('info');
  const [matiere, setMatiere] = useState('');
  const [text, setText] = useState('');
  const [sel, setSel] = useState<LibraryItem | null>(null);
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [cours, setCours] = useState('');
  const [loading, setLoading] = useState(false);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repo || !db) return;
    setLoading(true);
    loadIndex(repo, db).then(
      (it) => {
        setItems(it);
        setLoading(false);
      },
      () => {
        setMsg('Impossible de charger la bibliothèque. Vérifie ton jeton dans Réglages');
        setMsgType('error');
        setLoading(false);
      },
    );
  }, [repo, db]);

  const shown = useMemo(() => filterItems(items, { matiere: matiere || undefined, text }), [items, matiere, text]);
  const matieres = useMemo(() => [...new Set(items.map((i) => i.matiere))], [items]);

  const open = async (item: LibraryItem) => {
    if (!repo) return;
    setSel(item); setFiche(null); setCours(''); setMsg('');
    try {
      const { content } = await repo.readFile(item.path);
      if (item.kind === 'cours') { setCours(content); return; }
      const data = JSON.parse(content) as unknown;
      if (validateFiche(data).length) {
        setMsg('Cette fiche ne respecte plus le schéma. Ouvre-la dans Relire pour la corriger.');
        setMsgType('warning');
        return;
      }
      setFiche(data as Fiche);
    } catch {
      setMsg("Impossible d'ouvrir ce fichier. Réessayer");
      setMsgType('error');
    }
  };

  useEffect(() => { if (fiche && preview.current) renderFiche(preview.current, fiche); }, [fiche]);

  if (!repo) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <h3 style={{ marginTop: 0 }}>Dépôt GitHub non configuré</h3>
        <p style={{ color: 'var(--accent-dark)' }}>
          Ajoute ton jeton GitHub, le propriétaire et le nom du dépôt dans les <b>Réglages</b> pour accéder à la bibliothèque.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          placeholder="🔍 Rechercher par titre ou matière…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select value={matiere} onChange={(e) => setMatiere(e.target.value)} style={{ minWidth: 160 }}>
          <option value="">Toutes les matières ({items.length})</option>
          {matieres.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="badge">
          {shown.length} élément{shown.length > 1 ? 's' : ''}
        </span>
      </div>

      {msg && (
        <div className={`banner banner-${msgType}`} role="alert">
          <span className="banner-icon">{msgType === 'error' ? '❌' : msgType === 'warning' ? '⚠️' : '✓'}</span>
          <div className="banner-body">{msg}</div>
        </div>
      )}

      {loading && <div className="card">Chargement de la bibliothèque…</div>}

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8, margin: 0 }}>
        {shown.map((i) => {
          const isSelected = sel?.path === i.path;
          return (
            <li key={i.path} className="card" style={{ cursor: 'pointer', borderLeft: isSelected ? '4px solid var(--accent)' : undefined }}>
              <div onClick={() => open(i)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <b style={{ color: isSelected ? 'var(--accent)' : 'var(--text)' }}>{i.slug}</b>
                  <div style={{ fontSize: 12, color: 'var(--accent-dark)', marginTop: 2 }}>
                    Matière : <b>{i.matiere}</b> · Type : {i.kind === 'cours' ? 'Cours transcrit' : 'Fiche de révision'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {i.statut === 'verifie' && <span className="badge ok">✓ validée</span>}
                  <span className="badge">{i.kind}</span>
                </div>
              </div>
            </li>
          );
        })}
        {!loading && shown.length === 0 && (
          <li className="card" style={{ textAlign: 'center', color: 'var(--accent-dark)' }}>
            Aucun élément ne correspond à votre recherche.
          </li>
        )}
      </ul>

      {sel && (
        <div className="card" style={{ marginTop: 16, borderTop: '2px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, color: 'var(--accent-text)' }}>{sel.slug}</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {fiche && (
                <button className="btn btn-secondary btn-sm" onClick={() => printPages(fiche.meta.format ?? 'fiche')}>
                  📄 PDF
                </button>
              )}
              {fiche && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    const pages = [...(preview.current?.querySelectorAll<HTMLElement>('.fiche-page') ?? [])];
                    try {
                      const blobs = await exportPng(pages);
                      if (blobs.some(isLikelyBlank)) {
                        setMsg("L'image semble vide. Utilise l'export PDF");
                        setMsgType('warning');
                        return;
                      }
                      blobs.forEach((b, n) => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(b);
                        a.download = `${sel.slug}-${n + 1}.png`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                      });
                    } catch {
                      setMsg("L'export PNG a échoué. Utilise l'export PDF");
                      setMsgType('error');
                    }
                  }}
                >
                  🖼 PNG
                </button>
              )}
              {onEdit && sel.kind === 'fiche' && (
                <button className="btn btn-primary btn-sm" onClick={() => onEdit(sel.path)}>
                  ✏️ Modifier dans Relire
                </button>
              )}
              {fiche && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={!fiche.meta.brief || !onRedo}
                  onClick={() => fiche.meta.brief && onRedo?.(fiche.meta.brief)}
                >
                  🔄 Refaire avec ce brief
                </button>
              )}
              {fiche && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    try {
                      await setExemple(repo, sel.path, !fiche.meta.exemple);
                      setFiche({ ...fiche, meta: { ...fiche.meta, exemple: !fiche.meta.exemple } });
                      setMsg(fiche.meta.exemple ? 'Fiche retirée des exemples' : 'Fiche marquée comme exemple de style');
                      setMsgType('success');
                    } catch {
                      setMsg("Impossible d'enregistrer. Réessayer");
                      setMsgType('error');
                    }
                  }}
                >
                  {fiche.meta.exemple ? '★ Retirer des exemples' : '☆ Définir comme exemple de style'}
                </button>
              )}
            </div>
          </div>

          {fiche && <div className="print-area" ref={preview} style={{ overflow: 'auto', maxWidth: '100%', maxHeight: 600 }} />}
          {cours && (
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 500, overflow: 'auto', background: 'var(--page-bg)', padding: 12, borderRadius: 8, fontSize: 13 }}>
              {cours}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}


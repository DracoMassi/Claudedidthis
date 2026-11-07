import { useEffect, useState } from 'react';
import Cours from './ui/Cours';
import Generate from './ui/Generate';
import Library from './ui/Library';
import Review from './ui/Review';
import type { Brief } from './lib/types';
import type { Draft } from './lib/storage/db';
import Settings from './ui/Settings';
import { useDb, useRepo } from './ui/hooks';

export const ENTREES = ['Générer', 'Relire', 'Bibliothèque', 'Cours', 'Réglages'] as const;
export type Entree = (typeof ENTREES)[number];

const ICONS: Record<Entree, string> = {
  Générer: '✦',
  Relire: '🔍',
  Bibliothèque: '📚',
  Cours: '🎙',
  Réglages: '⚙',
};

export default function App() {
  const [entree, setEntree] = useState<Entree>('Générer');
  const repo = useRepo();
  const db = useDb();
  const [redo, setRedo] = useState<Brief | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);
  const quadrille = entree !== 'Relire';

  useEffect(() => {
    const handleNav = (e: Event) => {
      const target = (e as CustomEvent<string>).detail;
      if (ENTREES.includes(target as Entree)) {
        setEntree(target as Entree);
      }
    };
    window.addEventListener('sequentia-navigate', handleNav);
    return () => window.removeEventListener('sequentia-navigate', handleNav);
  }, []);

  const renderScreen = () => {
    switch (entree) {
      case 'Générer':
        return (
          <Generate
            repo={repo}
            db={db}
            initialBrief={redo}
            onOpenDraft={(d) => {
              setDraft(d);
              setEditPath(null);
              setEntree('Relire');
            }}
            onNavigate={(tab) => setEntree(tab as Entree)}
          />
        );
      case 'Relire':
        return (
          <Review
            repo={repo}
            db={db}
            draft={draft}
            path={editPath}
            onNavigate={(tab) => setEntree(tab as Entree)}
          />
        );
      case 'Bibliothèque':
        return (
          <Library
            repo={repo}
            db={db}
            onEdit={(p) => {
              setEditPath(p);
              setDraft(null);
              setEntree('Relire');
            }}
            onRedo={(b) => {
              setRedo(b);
              setEntree('Générer');
            }}
          />
        );
      case 'Cours':
        return (
          <Cours
            repo={repo}
            db={db}
            onNavigate={(tab) => setEntree(tab as Entree)}
          />
        );
      case 'Réglages':
        return <Settings />;
      default:
        return <div className="card">Écran « {entree} » introuvable.</div>;
    }
  };

  return (
    <div className={`app${quadrille ? ' grid-bg' : ''}`}>
      <div className="logo">sequentia</div>
      <nav className="nav" aria-label="Navigation">
        {ENTREES.map((e) => (
          <button key={e} aria-current={e === entree ? 'page' : undefined} onClick={() => setEntree(e)}>
            <span style={{ marginRight: 4 }}>{ICONS[e]}</span>
            {e}
          </button>
        ))}
      </nav>
      <h1 className="titre">{entree}</h1>
      {renderScreen()}
    </div>
  );
}


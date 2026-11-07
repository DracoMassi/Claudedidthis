import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { fxClass, Magnetic, spotMove, type Fx } from './fx';

type State = 'idle' | 'loading' | 'success' | 'error';
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> & {
  /** Action asynchrone. `false` ou une exception = échec ; tout le reste = succès. */
  run: () => Promise<boolean | void>;
  children: ReactNode;
  successLabel?: string;
  errorLabel?: string;
  /** Effet premium (un seul par écran). */
  fx?: Fx;
};

function Spinner() {
  return (
    <svg className="spin" width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Chargement">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function Check() {
  return (
    <svg className="check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" pathLength={1} />
    </svg>
  );
}

/** Bouton à états idle → loading → success | error. La largeur reste stable entre les états. */
export default function AsyncButton({ run, children, successLabel = 'Terminé', errorLabel = 'Réessayer', className = '', fx, ...rest }: Props) {
  const [state, setState] = useState<State>('idle');
  const [width, setWidth] = useState<number | undefined>();
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const click = async () => {
    if (state === 'loading') return;
    window.clearTimeout(timer.current);
    setWidth(ref.current?.offsetWidth);
    setState('loading');
    const t0 = Date.now();
    let ok = true;
    try { ok = (await run()) !== false; } catch { ok = false; }
    const reste = 400 - (Date.now() - t0); // évite le flash du spinner
    if (reste > 0) await new Promise((r) => setTimeout(r, reste));
    setState(ok ? 'success' : 'error');
    timer.current = window.setTimeout(() => { setState('idle'); setWidth(undefined); }, ok ? 1600 : 2200);
  };

  const btn = (
    <button ref={ref} {...rest} className={`${className} async ${fxClass(fx)}`.trim()} data-state={state} aria-busy={state === 'loading'}
      style={{ ...rest.style, minWidth: width }} onPointerMove={fx === 'spotlight' ? spotMove : undefined} onClick={() => void click()}>
      <span className="async-label" key={state}>
        {state === 'loading' && <Spinner />}
        {state === 'success' && <><Check />{successLabel}</>}
        {state === 'error' && errorLabel}
        {state === 'idle' && children}
      </span>
    </button>
  );
  return fx === 'magnetic' ? <Magnetic disabled={rest.disabled}>{btn}</Magnetic> : btn;
}

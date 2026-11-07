import { useRef, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react';

/** Effets « premium » : UN SEUL par écran (règle du guide), sur l'action principale. */
export type Fx = 'magnetic' | 'shine' | 'spotlight';

const reduit = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const fxClass = (fx?: Fx): string => (fx === 'shine' ? 'fx-shine' : fx === 'spotlight' ? 'fx-spot' : '');

/** Spotlight : le halo suit le pointeur (variables CSS --mx / --my). */
export function spotMove(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/** Magnetic : le bouton suit légèrement le curseur (souris / trackpad uniquement, jamais au doigt). */
export function Magnetic({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || disabled || e.pointerType !== 'mouse' || reduit()) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--tx', `${(e.clientX - (r.left + r.width / 2)) * 0.25}px`);
    el.style.setProperty('--ty', `${(e.clientY - (r.top + r.height / 2)) * 0.25}px`);
  };
  const leave = () => { ref.current?.style.setProperty('--tx', '0px'); ref.current?.style.setProperty('--ty', '0px'); };
  return <span ref={ref} className="magnetic" onPointerMove={move} onPointerLeave={leave}>{children}</span>;
}

export function FxButton({ fx, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { fx?: Fx }) {
  const btn = (
    <button {...rest} className={`${className} ${fxClass(fx)}`.trim()} onPointerMove={fx === 'spotlight' ? spotMove : rest.onPointerMove}>
      {children}
    </button>
  );
  return fx === 'magnetic' ? <Magnetic disabled={rest.disabled}>{btn}</Magnetic> : btn;
}

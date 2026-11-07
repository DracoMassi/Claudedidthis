import { useId, type CSSProperties, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/* Champs à label flottant : le <label> est lié au champ (htmlFor/id) et monte quand on tape.
   Le truc : placeholder=" " permet à CSS de savoir si le champ est vide (:placeholder-shown). */
type Base = { label: string; hint?: string; fieldStyle?: CSSProperties };

export function TextField({ label, hint, fieldStyle, ...rest }: Base & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field" style={fieldStyle}>
      <input id={id} aria-describedby={hint ? `${id}-h` : undefined} {...rest} placeholder=" " />
      <label htmlFor={id}>{label}</label>
      {hint && <small id={`${id}-h`} className="hint">{hint}</small>}
    </div>
  );
}

export function TextArea({ label, hint, fieldStyle, ...rest }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="field" style={fieldStyle}>
      <textarea id={id} aria-describedby={hint ? `${id}-h` : undefined} {...rest} placeholder=" " />
      <label htmlFor={id}>{label}</label>
      {hint && <small id={`${id}-h`} className="hint">{hint}</small>}
    </div>
  );
}

export function SelectField({ label, hint, fieldStyle, children, ...rest }: Base & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="field field-select" style={fieldStyle}>
      <select id={id} aria-describedby={hint ? `${id}-h` : undefined} {...rest}>{children}</select>
      <label htmlFor={id}>{label}</label>
      {hint && <small id={`${id}-h`} className="hint">{hint}</small>}
    </div>
  );
}

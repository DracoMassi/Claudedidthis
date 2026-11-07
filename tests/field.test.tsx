import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectField, TextArea, TextField } from '../src/ui/Field';

describe('champs à label flottant', () => {
  it('lie le label au champ et force placeholder=" "', () => {
    const html = renderToStaticMarkup(<TextField label="Chapitre" value="" onChange={() => undefined} />);
    const id = /id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain('placeholder=" "');
    expect(html).toContain('>Chapitre</label>');
  });
  it('gère textarea et select', () => {
    expect(renderToStaticMarkup(<TextArea label="Notes" value="" onChange={() => undefined} />)).toContain('<textarea');
    const sel = renderToStaticMarkup(<SelectField label="Matière" value="maths" onChange={() => undefined}><option>maths</option></SelectField>);
    expect(sel).toContain('field-select');
  });
  it("relie l'aide au champ via aria-describedby", () => {
    const html = renderToStaticMarkup(<TextField label="Clé" hint="Stockée sur l'appareil" onChange={() => undefined} />);
    expect(html).toMatch(/aria-describedby="[^"]+-h"/);
  });
});

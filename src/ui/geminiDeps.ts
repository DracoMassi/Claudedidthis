import { AbortedError, RateLimitError } from '../lib/errors';
import { callGemini } from '../lib/gemini/client';
import { RequestBudget } from '../lib/gemini/budget';
import type { GenerateDeps } from '../lib/generate/loop';
import { checkOverflow, renderFiche } from '../lib/render/renderFiche';
import { lintLatex } from '../lib/schema/lint';
import { validateFiche } from '../lib/schema/validate';
import type { Settings } from '../lib/storage/settings';
import type { Fiche } from '../lib/types';

/** Rend la fiche hors écran, aux dimensions de son format, pour mesurer erreurs KaTeX et débordement. */
export function renderOffscreen(f: Fiche): { katexErrors: string[]; overflow: number[] } {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0';
  document.body.appendChild(host);
  try {
    const { katexErrors } = renderFiche(host, f);
    return { katexErrors, overflow: checkOverflow(host) };
  } finally { host.remove(); }
}

/** Dépendances de la boucle de génération : Gemini (avec plafonds locaux), validation, lint, rendu. */
export function makeGenerateDeps(
  s: Settings,
  system: string,
  onTour: (n: number) => void,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): GenerateDeps {
  const budget = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget');
  let n = 0;
  return {
    llm: async (messages) => {
      if (opts?.signal?.aborted) throw new AbortedError();
      if (!budget.canSend()) throw new RateLimitError(budget.waitSeconds());
      budget.record();
      onTour(++n);
      return callGemini({
        key: s.geminiKey,
        model: s.model,
        system,
        messages,
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs,
      });
    },
    validate: validateFiche,
    lint: lintLatex,
    render: renderOffscreen,
  };
}


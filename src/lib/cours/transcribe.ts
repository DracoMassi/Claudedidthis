import { toBase64 } from '../bytes';
import { postGemini } from '../gemini/client';
import type { Lot } from './chunk';

/** Consigne de transcription (spec §7.2). */
export function transcriptionPrompt(lot: Lot): string {
  return `Transcris fidèlement ces pages de cours en Markdown (pages de ${lot.fromPage} à ${lot.toPage} du document d'origine : écris « de ${lot.fromPage} à ${lot.toPage} » dans tes repères).
- Commence chaque page par le commentaire <!-- page N --> (N = numéro de la page dans le document d'origine).
- Titres : # pour le chapitre, ## pour les sections ; blocs en citation, par exemple > **Définition.** ou > **Théorème (nom).**
- Formules en LaTeX entre $…$ (ou $$…$$), avec les macros \\R, \\dd, \\e, \\i, \\abs{}, \\inte{a}{b}, \\card.
- N'invente rien : ne complète pas, ne corrige pas ; écris [illisible] dès que tu hésites.
- Figures : remplace chaque figure par une légende entre crochets, par exemple [Figure : courbe de f sur [a, b]].
Réponds uniquement par le Markdown.`;
}

export async function transcribeLot(lot: Lot, deps: { llm(lot: Lot): Promise<string> }): Promise<string> {
  const t = await deps.llm(lot);
  return t.trim().replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

export function transcribeWithGemini(o: {
  key: string;
  model: string;
  lot: Lot;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  return postGemini({
    key: o.key,
    model: o.model,
    fetchImpl: o.fetchImpl,
    signal: o.signal,
    timeoutMs: o.timeoutMs,
    body: {
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: o.lot.mime ?? 'application/pdf', data: toBase64(o.lot.data) } }, { text: transcriptionPrompt(o.lot) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'text/plain' },
    },
  });
}


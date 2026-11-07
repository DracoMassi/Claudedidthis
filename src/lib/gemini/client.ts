import { AbortedError, AuthError, ModelError, NetworkError, RateLimitError, TimeoutError } from '../errors';

export type Msg = { role: 'user' | 'model'; text: string };

async function retryAfterSec(r: Response): Promise<number> {
  const h = Number(r.headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return Math.ceil(h);
  try {
    const j = (await r.clone().json()) as { error?: { details?: { retryDelay?: string }[] } };
    const d = j.error?.details?.find((x) => typeof x.retryDelay === 'string')?.retryDelay;
    const m = d?.match(/(\d+(?:\.\d+)?)s/);
    if (m) return Math.ceil(Number(m[1]));
  } catch { /* corps absent */ }
  return 30;
}

export type PostGeminiOpts = {
  key: string;
  model: string;
  body: unknown;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Envoie un corps `generateContent` à Gemini et renvoie le texte ; traduit les échecs en erreurs typées. */
export async function postGemini(o: PostGeminiOpts): Promise<string> {
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  if (o.signal?.aborted) throw new AbortedError();

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = o.timeoutMs ?? 45_000;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => controller.abort();
  if (o.signal) {
    o.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  let r: Response;
  try {
    r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent?key=${encodeURIComponent(o.key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o.body),
      signal: controller.signal,
    });
  } catch (err) {
    if (o.signal?.aborted) throw new AbortedError();
    if (timedOut) throw new TimeoutError(`Gemini n'a pas répondu dans le délai imparti (${Math.round(timeoutMs / 1000)} s)`);
    // Une erreur CORS peut masquer un 503 : on ne dit jamais « clé invalide » ici.
    throw new NetworkError("Gemini n'a pas répondu");
  } finally {
    clearTimeout(timer);
    if (o.signal) o.signal.removeEventListener('abort', onParentAbort);
  }

  if (r.status === 429) throw new RateLimitError(await retryAfterSec(r));
  if (r.status === 401 || r.status === 403) throw new AuthError('Clé refusée');
  if (r.status === 400) {
    const rawText = await r.clone().text();
    if (/api key/i.test(rawText)) throw new AuthError('Clé refusée');
    let detail = '';
    try {
      const errJson = JSON.parse(rawText) as { error?: { message?: string } };
      if (errJson.error?.message) detail = errJson.error.message;
    } catch { /* ignorer */ }
    throw new ModelError(`Gemini a répondu 400${detail ? ` : ${detail}` : ' (requête invalide)'}`, { details: detail });
  }
  if (!r.ok) throw new NetworkError(`Gemini a répondu ${r.status}`);

  const j = (await r.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
    promptFeedback?: {
      blockReason?: string;
    };
  };

  if (j.promptFeedback?.blockReason) {
    throw new ModelError(`Contenu bloqué par Gemini (${j.promptFeedback.blockReason})`);
  }

  const cand = j.candidates?.[0];
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    if (cand.finishReason === 'SAFETY') {
      throw new ModelError('Contenu bloqué par les filtres de sécurité de Gemini (SAFETY)', { finishReason: 'SAFETY' });
    }
    if (cand.finishReason === 'MAX_TOKENS') {
      throw new ModelError('Réponse interrompue : limite de jetons atteinte (MAX_TOKENS)', { finishReason: 'MAX_TOKENS' });
    }
    if (cand.finishReason === 'RECITATION') {
      throw new ModelError('Contenu bloqué pour citation excessive (RECITATION)', { finishReason: 'RECITATION' });
    }
  }

  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new NetworkError('Réponse vide de Gemini');
  return text;
}

export function callGemini(o: {
  key: string;
  model: string;
  system: string;
  messages: Msg[];
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
      systemInstruction: { parts: [{ text: o.system }] },
      contents: o.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    },
  });
}


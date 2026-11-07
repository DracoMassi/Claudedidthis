import { AbortedError, AuthError, ConflictError, ModelError, NetworkError, NotFoundError, RateLimitError, TimeoutError } from '../lib/errors';

/** Message pour l'utilisateur : ce qui s'est passé, puis quoi faire, sans jargon. */
export function messageFor(err: unknown, ctx: { offline?: boolean; source?: 'gemini' | 'github' } = {}): string {
  const source = ctx.source ?? 'gemini';
  if (err instanceof AbortedError) return 'Opération annulée';
  if (err instanceof RateLimitError) return `Quota atteint. Réessaie dans ${err.retryAfterSec} secondes`;
  if (err instanceof TimeoutError) {
    return source === 'github'
      ? "GitHub n'a pas répondu à temps. Réessayer"
      : "Gemini n'a pas répondu à temps (délai dépassé). Réessayer";
  }
  if (err instanceof NetworkError) {
    if (ctx.offline) return 'Hors connexion. Enregistrement impossible, ton brouillon est conservé';
    return source === 'github' ? "GitHub n'a pas répondu. Réessayer" : "Gemini n'a pas répondu. Réessayer";
  }
  if (err instanceof ModelError) return err.message;
  if (err instanceof AuthError) return source === 'github' ? 'Ajoute ou renouvelle ton jeton GitHub dans Réglages' : 'Ajoute ta clé Gemini dans Réglages';
  if (err instanceof ConflictError) return 'Cette fiche a changé. Comparer, écraser ou annuler';
  if (err instanceof NotFoundError) return 'Fichier introuvable dans le dépôt';
  return 'Une erreur est survenue. Réessayer';
}


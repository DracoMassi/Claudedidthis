export class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Quota atteint, réessayer dans ${retryAfterSec} s`);
    this.name = 'RateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}
export class AuthError extends Error {
  constructor(message = 'Clé ou jeton refusé') { super(message); this.name = 'AuthError'; }
}
export class NetworkError extends Error {
  constructor(message = 'Pas de réponse du réseau') { super(message); this.name = 'NetworkError'; }
}
export class TimeoutError extends NetworkError {
  constructor(message = "Délai d'attente dépassé (la requête n'a pas répondu à temps)") {
    super(message);
    this.name = 'TimeoutError';
  }
}
export class AbortedError extends Error {
  constructor(message = 'Opération annulée') {
    super(message);
    this.name = 'AbortedError';
  }
}
export class ModelError extends Error {
  finishReason?: string;
  details?: string;
  constructor(message: string, opts: { finishReason?: string; details?: string } = {}) {
    super(message);
    this.name = 'ModelError';
    this.finishReason = opts.finishReason;
    this.details = opts.details;
  }
}
export class ConflictError extends Error {
  constructor(message = 'Le fichier a changé ailleurs') { super(message); this.name = 'ConflictError'; }
}
export class NotFoundError extends Error {
  constructor(message = 'Fichier introuvable') { super(message); this.name = 'NotFoundError'; }
}


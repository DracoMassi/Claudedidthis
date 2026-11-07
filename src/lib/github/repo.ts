import { AbortedError, AuthError, ConflictError, NetworkError, NotFoundError, TimeoutError } from '../errors';

export type TreeEntry = { path: string; type: 'blob' | 'tree'; sha: string };

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export class GithubRepo {
  private owner: string;
  private name: string;
  private token: string;
  private fetchImpl: typeof fetch;
  constructor(owner: string, name: string, token: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.owner = owner; this.name = name; this.token = token; this.fetchImpl = fetchImpl;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    accept = 'application/vnd.github+json',
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<Response> {
    if (opts.signal?.aborted) throw new AbortedError('Opération GitHub annulée');

    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = opts.timeoutMs ?? 25_000;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onParentAbort = () => controller.abort();
    if (opts.signal) {
      opts.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    let r: Response;
    try {
      r = await this.fetchImpl(`https://api.github.com/repos/${this.owner}/${this.name}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
      });
    } catch {
      if (opts.signal?.aborted) throw new AbortedError('Opération GitHub annulée');
      if (timedOut) throw new TimeoutError(`GitHub n'a pas répondu dans le délai imparti (${Math.round(timeoutMs / 1000)} s)`);
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort);
    }
    if (r.status === 401 || r.status === 403) throw new AuthError('Jeton refusé ou expiré');
    if (r.status === 404) throw new NotFoundError();
    if (r.status === 409 || r.status === 422) throw new ConflictError();
    if (!r.ok) throw new NetworkError(`GitHub a répondu ${r.status}`);
    return r;
  }

  async listTree(opts?: { signal?: AbortSignal }): Promise<TreeEntry[]> {
    const j = (await (await this.request('/git/trees/HEAD?recursive=1', {}, 'application/vnd.github+json', opts)).json()) as { tree: TreeEntry[] };
    return j.tree.map(({ path, type, sha }) => ({ path, type, sha }));
  }

  async readFile(path: string, opts?: { signal?: AbortSignal }): Promise<{ content: string; sha: string }> {
    const j = (await (await this.request(`/contents/${encodePath(path)}`, {}, 'application/vnd.github+json', opts)).json()) as { content: string; sha: string };
    return { content: fromBase64(j.content), sha: j.sha };
  }

  async readBinary(path: string, opts?: { signal?: AbortSignal }): Promise<ArrayBuffer> {
    return (await this.request(`/contents/${encodePath(path)}`, {}, 'application/vnd.github.raw+json', opts)).arrayBuffer();
  }

  async writeFile(path: string, content: string, opts: { message: string; sha?: string; signal?: AbortSignal }): Promise<{ sha: string }> {
    const body: Record<string, string> = { message: opts.message, content: toBase64(content) };
    if (opts.sha) body.sha = opts.sha;
    const j = (await (await this.request(`/contents/${encodePath(path)}`, { method: 'PUT', body: JSON.stringify(body) }, 'application/vnd.github+json', opts)).json()) as { content: { sha: string } };
    return { sha: j.content.sha };
  }
}


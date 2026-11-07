import { NetworkError, RateLimitError } from '../errors';
import { fromBase64, toBase64 } from '../bytes';
import type { Db } from '../storage/db';
import type { Lot } from './chunk';

type StoredLot = { index: number; fromPage: number; toPage: number; mime?: string; b64: string };
type State = { lots: StoredLot[]; results: string[]; next: number };
const key = (id: string) => `import:${id}`;
const INDEX = 'import:index';

/** File d'import reprenable : la progression et les lots sont enregistrés dans la base locale après chaque lot. */
export class ImportQueue {
  private db: Db;
  private transcribe: (lot: Lot) => Promise<string>;
  constructor(db: Db, transcribe: (lot: Lot) => Promise<string>) { this.db = db; this.transcribe = transcribe; }

  private async load(id: string): Promise<State> {
    const st = (await this.db.get(key(id))) as State | undefined;
    if (!st) throw new Error(`Import inconnu : ${id}`);
    return st;
  }
  async ids(): Promise<string[]> { return ((await this.db.get(INDEX)) as string[] | undefined) ?? []; }

  async enqueue(id: string, lots: Lot[]): Promise<void> {
    const st: State = {
      lots: lots.map((l) => ({ index: l.index, fromPage: l.fromPage, toPage: l.toPage, mime: l.mime, b64: toBase64(l.data) })),
      results: lots.map(() => ''), next: 0,
    };
    await this.db.put(key(id), st);
    const ids = await this.ids();
    if (!ids.includes(id)) await this.db.put(INDEX, [...ids, id]);
  }

  /** Traite les lots restants. Quota ou réseau : s'arrête avec 'paused' sans perdre ce qui est fait. */
  async run(id: string, opts?: { signal?: AbortSignal; onLotStart?: (lotIndex: number) => void }): Promise<'done' | 'paused'> {
    const st = await this.load(id);
    for (let i = st.next; i < st.lots.length; i++) {
      if (opts?.signal?.aborted) return 'paused';
      opts?.onLotStart?.(i);
      const s = st.lots[i];
      try {
        st.results[i] = await this.transcribe({ index: s.index, fromPage: s.fromPage, toPage: s.toPage, mime: s.mime, data: fromBase64(s.b64) });
      } catch (e) {
        if (e instanceof RateLimitError || e instanceof NetworkError) return 'paused';
        if (opts?.signal?.aborted) return 'paused';
        throw e;
      }
      st.next = i + 1;
      await this.db.put(key(id), st);
    }
    return 'done';
  }


  async progress(id: string): Promise<{ done: number; total: number }> {
    const st = await this.load(id);
    return { done: st.next, total: st.lots.length };
  }
  async lots(id: string): Promise<Lot[]> {
    const st = await this.load(id);
    return st.lots.map((l) => ({ index: l.index, fromPage: l.fromPage, toPage: l.toPage, mime: l.mime, data: fromBase64(l.b64) }));
  }
  async markdown(id: string): Promise<string> {
    const st = await this.load(id);
    return st.results.slice(0, st.next).join('\n\n');
  }
  async remove(id: string): Promise<void> {
    await this.db.put(key(id), undefined);
    await this.db.put(INDEX, (await this.ids()).filter((x) => x !== id));
  }
}

/**
 * One door to the model. Every reply is recorded by content hash, so a reviewer with no key can replay
 * a run byte for byte, and a changed prompt can never silently reuse an old reply.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface LlmRequest { role: 'agent' | 'caller' | 'judge'; model: string; system: string; prompt: string; salt: string }
export interface Llm { complete(r: LlmRequest): Promise<string> }

export const keyOf = (r: LlmRequest) => createHash('sha256').update(JSON.stringify([r.role, r.model, r.system, r.prompt, r.salt])).digest('hex');

export class RecordedLlm implements Llm {
  private mem = new Map<string, string>();
  public misses = 0;
  constructor(private dir: string, private live: Llm | null) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')) : [])
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) if (line) { const o = JSON.parse(line); this.mem.set(o.key, o.text); }
  }
  async complete(r: LlmRequest): Promise<string> {
    const key = keyOf(r);
    const hit = this.mem.get(key);
    if (hit !== undefined) return hit;
    this.misses++;
    if (!this.live) throw new Error(`No recording for this ${r.role} call. Replay mode never calls a model.`);
    const text = await this.live.complete(r);
    this.mem.set(key, text);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(path.join(this.dir, `${r.role}.jsonl`), JSON.stringify({ key, model: r.model, salt: r.salt, text }) + '\n');
    return text;
  }
}

/** Uses the local `claude` sign-in. No key is read, stored or logged by this project. */
export class ClaudeCli implements Llm {
  complete(r: LlmRequest): Promise<string> {
    return retry(3, () => new Promise((ok, bad) => {
      const p = spawn('claude', ['-p', '--model', r.model, '--system-prompt', r.system, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--effort', 'low', '--output-format', 'json', '--no-session-persistence'], { env: { ...process.env, CLAUDECODE: '' }, cwd: '/tmp' });
      let out = ''; let err = '';
      const t = setTimeout(() => p.kill('SIGKILL'), 90_000);
      p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
      p.on('error', bad);
      p.on('close', () => {
        clearTimeout(t);
        try {
          const j = JSON.parse(out);
          if (j.is_error || typeof j.result !== 'string') throw new Error(String(j.result ?? err).slice(0, 200));
          ok(j.result);
        } catch (e) { bad(e as Error); }
      });
      p.stdin.end(r.prompt);
    }));
  }
}
async function retry<T>(n: number, f: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) try { return await f(); } catch (e) { if (i >= n) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
}
export function parseJson<T>(text: string): T | null {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)) as T; } catch { return null; }
}

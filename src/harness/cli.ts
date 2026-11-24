import fs from 'node:fs'; import path from 'node:path';
import { loadScenarios, p, readText, sha } from '../core/load.js';
import type { RunMeta, Trace } from '../core/types.js';
import { judgeBelief } from '../eval/belief.js';
import { score } from '../eval/score.js';
import { runScenario } from './conversation.js';
import { ClaudeCli, RecordedLlm } from './llm.js';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k: string, d = '') => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] ?? d : d; };
const flag = (k: string) => rest.includes(`--${k}`);
const scenarios = loadScenarios();
const llm = (replay: boolean) => new RecordedLlm(p('data', 'llm-cache'), replay ? null : new ClaudeCli());
const runFile = (id: string) => p('data', 'runs', `${id}.json`);
type RunFile = { meta: RunMeta; traces: Trace[] };

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]!); } }));
  return out;
}
async function makeRun(version: string, model: string, repeats: number, id: string, replay: boolean, only: string, note: string, callerVersion: string): Promise<{ file: RunFile; failed: string[] }> {
  const agentPrompt = readText('agents', `${version}.md`); const protocol = readText('agents', 'protocol.md'); const callerPrompt = readText('agents', `caller-${callerVersion}.md`);
  const L = llm(replay); const failed: string[] = [];
  const jobs = scenarios.filter((s) => !only || only.split(',').some((k) => s.id.includes(k))).flatMap((s) => Array.from({ length: repeats }, (_, i) => ({ s, i: i + 1 })));
  const traces = await pool(jobs, replay ? 1 : Number(opt('parallel', '3')), async ({ s, i }) => {
    try { const t = await runScenario(s, { llm: L, model, agentPrompt, protocol, callerPrompt, callerVersion, agentVersion: version, runId: id, repeat: i }); if (!replay) console.log(id, s.id, i, t.ended, t.events.length); return t; }
    catch (e) { failed.push(`${s.id}#${i}: ${(e as Error).message}`); return null; }
  });
  const meta: RunMeta = { id, agentVersion: version, agentPromptSha: sha(agentPrompt + protocol), model, repeats, createdAt: new Date().toISOString(), note, scenarioSetSha: sha(JSON.stringify(scenarios)), callerVersion, callerPromptSha: sha(callerPrompt) };
  return { file: { meta, traces: traces.filter((t): t is Trace => !!t) }, failed };
}
if (cmd === 'run') {
  const version = opt('agent', 'baseline'); const id = opt('id', version);
  const { file, failed } = await makeRun(version, opt('model', 'claude-haiku-5-5'), Number(opt('repeats', '2')), id, flag('replay'), opt('only'), opt('note'), opt('caller', 'v2'));
  fs.writeFileSync(runFile(id), JSON.stringify(file, null, 1));
  console.log(`${file.traces.length} traces saved, ${failed.length} failed to run`); failed.forEach((f) => console.log('  ', f));
  process.exitCode = failed.length ? 1 : 0;
} else if (cmd === 'judge') {
  const v = opt('version', 'v1'); const model = opt('model', 'claude-sonnet-5-5'); const L = llm(flag('replay'));
  const out: Record<string, unknown> = {}; const system = readText('judges', `belief-${v}.md`);
  const all = fs.readdirSync(p('data', 'runs')).filter((f) => f.endsWith('.json')).flatMap((f) => (JSON.parse(fs.readFileSync(path.join(p('data', 'runs'), f), 'utf8')) as RunFile).traces);
  await pool(all, 3, async (t) => { const s = scenarios.find((x) => x.id === t.scenarioId)!; out[t.id] = await judgeBelief(L, model, system, v, s, t); });
  fs.mkdirSync(p('data', 'judge'), { recursive: true });
  fs.writeFileSync(p('data', 'judge', `${v}.json`), JSON.stringify({ version: v, model, promptSha: sha(system), outputs: Object.fromEntries(Object.entries(out).sort()) }, null, 1));
  console.log(`judged ${all.length}`);
} else if (cmd === 'rescore') {
  for (const f of fs.readdirSync(p('data', 'runs')).filter((x) => x.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(p('data', 'runs'), f), 'utf8')) as RunFile; const c: Record<string, string> = {};
    for (const t of r.traces) { const s = score(scenarios.find((x) => x.id === t.scenarioId)!, t); for (const m of s.metrics) if (m.verdict === 'fail') { const k = `${m.metric}/${m.mechanism}`; c[k] = `${c[k] ? c[k] + ', ' : ''}${t.scenarioId.slice(0, 9)}#${t.repeat}`; } if (!s.simulatorValid) c['SIM INVALID'] = `${c['SIM INVALID'] ?? ''} ${t.scenarioId}#${t.repeat}`; }
    console.log(r.meta.id, r.traces.length, 'traces'); console.log(c);
  }
} else if (cmd === 'verify-replay') {
  let bad = 0;
  for (const f of fs.readdirSync(p('data', 'runs')).filter((x) => x.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(p('data', 'runs'), f), 'utf8')) as RunFile;
    if (r.traces.some((x) => x.human)) { console.log(`${r.meta.id}: played by a person, not replayed`); continue; }
    const L = llm(true); const strip = (t: Trace) => JSON.stringify([t.scenarioId, t.repeat, t.events, t.final, t.ended]); let same = 0; const failed: string[] = [];
    for (const t of r.traces) {
      const s = scenarios.find((x) => x.id === t.scenarioId)!;
      try { const again = await runScenario(s, { llm: L, model: r.meta.model, agentPrompt: readText('agents', `${r.meta.agentVersion}.md`), protocol: readText('agents', 'protocol.md'), callerPrompt: readText('agents', `caller-${r.meta.callerVersion}.md`), callerVersion: r.meta.callerVersion, agentVersion: r.meta.agentVersion, runId: r.meta.id, repeat: t.repeat }); if (strip(again) === strip(t)) same++; } catch { failed.push(t.id); }
    }
    console.log(`${r.meta.id}: ${same} of ${r.traces.length} replay exactly${failed.length ? `, ${failed.length} without a recording` : ''}`);
    if (same !== r.traces.length) bad++;
  }
  process.exitCode = bad ? 1 : 0;
} else console.log('run | judge | rescore | verify-replay');

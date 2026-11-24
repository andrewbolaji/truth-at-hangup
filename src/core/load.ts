import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto'; import { z } from 'zod';
import { Scenario } from './types.js';
export const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../..');
export const p = (...x: string[]) => path.join(ROOT, ...x);
export const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
export const readText = (...x: string[]) => fs.readFileSync(p(...x), 'utf8');
export const loadScenarios = (): Scenario[] => z.array(Scenario).parse(JSON.parse(readText('data', 'scenarios', 'scenarios.json')));

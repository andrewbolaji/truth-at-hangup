import express from 'express'; import fs from 'node:fs'; import { p } from '../core/load.js'; import { makeApp } from './app.js'; import { Store } from './store.js';
const store = new Store(p('eval.db')); const app = makeApp(store); const dist = p('dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.use((_q, r) => r.sendFile(p('dist', 'index.html'))); }
const port = Number(process.env.PORT ?? 4173);
app.listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}  (${store.traces.size} calls, ${store.labels().length} labels)`));

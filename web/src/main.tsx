import { StrictMode, useEffect, useState } from 'react'; import { createRoot } from 'react-dom/client'; import './app.css';
import { Runs, RunPage } from './runs'; import { Compare } from './compare'; import { CallPage } from './call'; import { LabelPage } from './label'; import { FindingsPage } from './findings'; import { TourPage } from './tour'; import { LivePage } from './live'; import { CalPage } from './calibration';
function App() {
  const [h, set] = useState(location.hash || '#/'); useEffect(() => { const f = () => { set(location.hash || '#/'); scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [a = '', b = '', c = ''] = h.replace(/^#\//, '').split('/').map(decodeURIComponent);
  const nav: [string, string][] = [['', 'Runs'], ['tour', 'Walkthrough'], ['findings', 'Findings'], ['compare', 'Compare'], ['calibrate', 'Judge check'], ['label', 'Label calls'], ['live', 'Play the caller']];
  return <><header><a className="brand" href="#/">Truth at Hang-up</a><nav aria-label="Main">{nav.map(([k, n]) => <a key={k} href={`#/${k}`} aria-current={a === k ? 'page' : undefined}>{n}</a>)}</nav></header>
    <main>{a === '' ? <Runs /> : a === 'run' ? <RunPage id={b} /> : a === 'compare' ? <Compare a={b} b={c} /> : a === 'call' ? <CallPage key={b} id={b} /> : a === 'label' ? <LabelPage /> : a === 'findings' ? <FindingsPage /> : a === 'tour' ? <TourPage /> : a === 'live' ? <LivePage /> : a === 'calibrate' ? <CalPage /> : <p>That page doesn’t exist.</p>}</main></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

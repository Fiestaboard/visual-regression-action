import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReportData } from '../../src/report-data';
import { App } from './App';
import './styles.css';

function readData(): ReportData | null {
  // Unfilled (vite dev) the tag still holds the placeholder, which isn't JSON.
  // Don't spell the placeholder out here: the embed step requires it exactly once.
  const raw = (document.getElementById('vrt-data')?.textContent ?? '').trim();
  return raw.startsWith('{') ? (JSON.parse(raw) as ReportData) : null;
}

async function boot() {
  let data = readData();
  // `npm run dev:ui` serves the template unfilled; draw a fixture instead.
  // The dynamic import sits behind a DEV constant, so production drops it.
  if (!data && import.meta.env.DEV) data = (await import('../dev-data')).makeDevData();
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      {data ? <App data={data} /> : <p className="p-8">This report has no data.</p>}
    </StrictMode>
  );
}

void boot();

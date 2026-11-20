import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { appFiles, nativeHttp, sqliteDb } from './device';
import { Repo } from './repo';
import './index.css';

const root = createRoot(document.getElementById('root')!);
sqliteDb()
  .then(async (db) => {
    const repo = new Repo(db, nativeHttp, appFiles);
    await repo.open();
    root.render(<StrictMode><App repo={repo} /></StrictMode>);
  })
  .catch((e) => root.render(<p style={{ padding: 24 }}>Could not open the notebook on this phone: {String(e?.message ?? e)}</p>));

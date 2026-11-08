import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';

// Personal Microsoft accounts only (the institution tenant is not usable; see android_implementation.md).
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const CLIENT_ID = (import.meta.env.VITE_GRAPH_CLIENT_ID as string | undefined) ?? '';
const SCOPE = 'Files.ReadWrite offline_access';
const GRAPH = 'https://graph.microsoft.com/v1.0';
export const REDIRECT = 'org.benchflow.companion://auth';

interface Tokens { access: string; refresh: string; expiresAt: number }
// shortcut: tokens in plain Preferences (app-private SharedPreferences); move to Android Keystore in phase 4.
const TOKENS_KEY = 'graph_tokens';

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  // CapacitorHttp sends this natively (no Origin header), which the endpoint requires for a mobile client.
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, ...params }).toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
  const tokens = { access: json.access_token, refresh: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
  await Preferences.set({ key: TOKENS_KEY, value: JSON.stringify(tokens) });
  return tokens;
}

/** Authorization code + PKCE in a Custom Tab, returning through the org.benchflow.companion:// intent filter. */
export async function signIn(): Promise<void> {
  if (!CLIENT_ID) throw new Error('VITE_GRAPH_CLIENT_ID is not set (mobile/.env.local), see SPIKE.md');
  const verifier = randomString();
  const state = randomString();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = `${AUTHORITY}/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPE,
    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
  });
  const handles: Promise<{ remove: () => Promise<void> }>[] = [];
  const code = await new Promise<string>((resolve, reject) => {
    handles.push(
      App.addListener('appUrlOpen', ({ url: back }) => {
        if (!back.startsWith(REDIRECT)) return;
        const q = new URL(back).searchParams;
        if (q.get('state') !== state) reject(new Error('state mismatch'));
        else if (q.get('error')) reject(new Error(q.get('error_description') || q.get('error') || 'sign-in failed'));
        else resolve(q.get('code') || '');
        Browser.close().catch(() => {});
      }),
      Browser.addListener('browserFinished', () => reject(new Error('sign-in window closed'))),
    );
    Browser.open({ url }).catch(reject);
  }).finally(() => handles.forEach((h) => void h.then((x) => x.remove())));
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
}

export async function signOut() { await Preferences.remove({ key: TOKENS_KEY }); }

async function accessToken(): Promise<{ token: string; refreshed: boolean }> {
  const raw = (await Preferences.get({ key: TOKENS_KEY })).value;
  if (!raw) throw new Error('not signed in');
  const t: Tokens = JSON.parse(raw);
  if (t.expiresAt - 60_000 > Date.now()) return { token: t.access, refreshed: false };
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  return { token: fresh.access, refreshed: true };
}

/**
 * The relay operations sync needs, against <folder>/spike-probe.json in the signed-in OneDrive:
 * token (refresh if expired), create, read, overwrite, list, delete, confirm gone.
 * Stops at the first failure. Every line goes to `log`.
 */
export async function runChecks(folder: string, log: (line: string) => void): Promise<boolean> {
  const net = await Network.getStatus();
  log(`--- ${new Date().toISOString()} network=${net.connectionType} folder=${folder}`);
  let token = '';
  const g = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(GRAPH + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  const dir = folder.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const item = `/me/drive/root:/${dir}/spike-probe.json`;
  const put = (body: string) => g(`${item}:/content`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body });
  const read = async () => (await g(`${item}:/content`)).text();
  const v1 = `probe 1 ${Date.now()}`;
  const v2 = `probe 2 ${Date.now()}`;

  const steps: [string, () => Promise<string | void>][] = [
    ['token', async () => { const t = await accessToken(); token = t.token; return t.refreshed ? 'refreshed' : 'cached'; }],
    ['create', async () => { await put(v1); }],
    ['read', async () => { const got = await read(); if (got !== v1) throw new Error(`read back "${got}"`); }],
    ['overwrite', async () => { await put(v2); const got = await read(); if (got !== v2) throw new Error(`read back "${got}"`); }],
    ['list', async () => {
      const json = await (await g(`/me/drive/root:/${dir}:/children?$select=name`)).json();
      if (!json.value?.some((f: { name: string }) => f.name === 'spike-probe.json')) throw new Error('file not listed');
      return `${json.value.length} items`;
    }],
    ['delete', async () => { const r = await g(item, { method: 'DELETE' }); if (r.status !== 204) throw new Error(`HTTP ${r.status}`); }],
    ['gone', async () => { const r = await g(item); if (r.status !== 404) throw new Error(`still there (HTTP ${r.status})`); }],
  ];
  for (const [name, fn] of steps) {
    const t0 = performance.now();
    try {
      const detail = await fn();
      log(`PASS ${name} ${Math.round(performance.now() - t0)}ms ${detail ?? ''}`.trim());
    } catch (e) {
      log(`FAIL ${name} ${Math.round(performance.now() - t0)}ms ${(e as Error).message}`);
      return false;
    }
  }
  return true;
}

/** Plain GET with a timeout, for the optional LAN check against a desktop on the same network. */
export async function lanProbe(url: string, log: (line: string) => void) {
  const net = await Network.getStatus();
  const t0 = performance.now();
  try {
    const res = await Promise.race([
      fetch(url),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout after 5 s')), 5000)),
    ]);
    log(`${res.ok ? 'PASS' : 'FAIL'} lan ${url} HTTP ${res.status} ${Math.round(performance.now() - t0)}ms network=${net.connectionType}`);
  } catch (e) {
    log(`FAIL lan ${url} ${(e as Error).message} network=${net.connectionType}`);
  }
}

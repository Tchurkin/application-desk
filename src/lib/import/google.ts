import { googleDocSources, type GDoc, type SourceDoc } from "./sources";

/*
 * Importing straight from Google Drive, in the browser: Google's sign-in asks the student for
 * access to only the files they pick (the drive.file scope), Google's Picker lets them pick
 * docs (several at once, from inside a folder), and the Docs API reads each one with all of its
 * tabs. Only the text of the pieces they choose to import goes to this site's server (to save
 * it), and it never sees the rest of their Drive.
 *
 * Needs a Google Cloud project: NEXT_PUBLIC_GOOGLE_CLIENT_ID (OAuth client), NEXT_PUBLIC_GOOGLE_API_KEY
 * and NEXT_PUBLIC_GOOGLE_APP_ID (the project number). See docs/google-import.md.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Google's browser libraries ship no types here. */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
  return clientId && apiKey ? { clientId, apiKey, appId } : null;
}

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const DOC_MIME = "application/vnd.google-apps.document";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (found?.dataset.loaded) return resolve();
    const s = found ?? document.createElement("script");
    s.addEventListener("load", () => {
      s.dataset.loaded = "1";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error("Couldn't load Google's sign-in. Check your connection and try again.")));
    if (!found) {
      s.src = src;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

let ready: Promise<void> | null = null;

/** Load Google's libraries ahead of time: sign-in must open straight from the click. */
export function prepareGoogle(): Promise<void> {
  ready ??= Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]).then(
    () => new Promise<void>((resolve) => window.gapi.load("picker", { callback: () => resolve() })),
  );
  return ready;
}

export function googleReady(): boolean {
  return !!window.google?.accounts?.oauth2 && !!window.google?.picker;
}

/**
 * Ask for access (call this directly from a click, after prepareGoogle has finished), let the
 * student pick docs, and read them. Resolves with nothing picked if they cancel.
 */
export function pickFromGoogle(
  cfg: GoogleConfig,
  onReading: (count: number) => void,
): Promise<{ docs: SourceDoc[]; skippedFolders: number; failed: string[] }> {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPE,
      callback: (resp: { access_token?: string; error?: string }) => {
        if (resp.error || !resp.access_token) return reject(new Error("Google sign-in didn't finish."));
        showPicker(cfg, resp.access_token, onReading).then(resolve, reject);
      },
      error_callback: (e: { type?: string }) =>
        reject(new Error(e?.type === "popup_closed" ? "Google sign-in was closed." : "Google sign-in was blocked. Allow pop-ups for this site and try again.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function showPicker(
  cfg: GoogleConfig,
  token: string,
  onReading: (count: number) => void,
): Promise<{ docs: SourceDoc[]; skippedFolders: number; failed: string[] }> {
  const g = window.google.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.DOCUMENTS).setIncludeFolders(true).setMode(g.DocsViewMode.LIST);
    const builder = new g.PickerBuilder()
      .addView(view)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setTitle("Pick your essay docs (open a folder, then Shift-click to pick several)")
      .setCallback(async (data: { action: string; docs?: { id: string; name: string; mimeType: string }[] }) => {
        if (data.action === g.Action.CANCEL) return resolve({ docs: [], skippedFolders: 0, failed: [] });
        if (data.action !== g.Action.PICKED) return;
        const picked = data.docs ?? [];
        const docs = picked.filter((d) => d.mimeType === DOC_MIME);
        onReading(docs.length);
        const failed: string[] = [];
        const read = await Promise.all(
          docs.map(async (d, i) => {
            const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(d.id)}?includeTabsContent=true`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              failed.push(d.name);
              return [];
            }
            return googleDocSources((await res.json()) as GDoc, `g${i}`);
          }),
        );
        resolve({ docs: read.flat(), skippedFolders: picked.filter((d) => d.mimeType === FOLDER_MIME).length, failed });
      });
    if (cfg.appId) builder.setAppId(cfg.appId);
    builder.build().setVisible(true);
  });
}

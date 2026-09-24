import { supabaseEnv } from "@/lib/supabase/env";
import { counselorInstaller, INSTALLER_NAME } from "./installer";

/**
 * Build the counselor's setup file for a connector token and hand it to the browser as a
 * download. The token never leaves this browser except inside the file.
 */
export function downloadInstaller(token: string) {
  const { url, key } = supabaseEnv();
  const file = counselorInstaller({ site: window.location.origin, supabaseUrl: url, supabaseKey: key, token });
  const href = URL.createObjectURL(new Blob([file], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = INSTALLER_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

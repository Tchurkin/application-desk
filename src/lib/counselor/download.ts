import { supabaseEnv } from "@/lib/supabase/env";
import { counselorInstaller, INSTALLER_NAME } from "./installer";
import { MAC_ZIP_NAME, macInstallerZip } from "./mac-installer";

export type InstallerPlatform = "windows" | "mac";

/**
 * Build the counselor's setup file for a connector token and hand it to the browser as a
 * download: a .cmd for Windows, a zip holding a .command for Mac. The token never leaves this
 * browser except inside the file.
 */
export async function downloadInstaller(token: string, platform: InstallerPlatform) {
  const { url, key } = supabaseEnv();
  const config = { site: window.location.origin, supabaseUrl: url, supabaseKey: key, token };
  const blob =
    platform === "mac"
      ? new Blob([(await macInstallerZip(config)) as Uint8Array<ArrayBuffer>], { type: "application/zip" })
      : new Blob([counselorInstaller(config)], { type: "application/octet-stream" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = platform === "mac" ? MAC_ZIP_NAME : INSTALLER_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

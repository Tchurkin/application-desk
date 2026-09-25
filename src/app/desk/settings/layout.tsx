import type { ReactNode } from "react";
import { SettingsNav } from "./settings-nav";

export const metadata = { title: "Settings" };

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl">Settings</h1>
      <div className="grid items-start gap-6 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
        <SettingsNav />
        <div className="max-w-2xl min-w-0">{children}</div>
      </div>
    </main>
  );
}

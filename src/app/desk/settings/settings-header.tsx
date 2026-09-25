import type { ReactNode } from "react";

/** A settings page's heading and what it's for. */
export function SettingsHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-5">
      <h2 className="font-serif text-2xl">{title}</h2>
      {children && <div className="mt-1 flex flex-col gap-2 text-sm text-muted">{children}</div>}
    </header>
  );
}

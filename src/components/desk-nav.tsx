"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** The desk's top-level pages. `base` is "/desk" for the owner, "/shared/<id>" for members. */
export function DeskNav({ base, owner }: { base: string; owner: boolean }) {
  const path = usePathname();
  const pages = [
    { href: `${base}/write`, label: "Write", match: (p: string) => p.startsWith(`${base}/write`) || p.startsWith(`${base}/piece/`) },
    { href: base, label: "Board", match: (p: string) => p === base || p.startsWith(`${base}/college/`) },
    { href: `${base}/progress`, label: "Progress", match: (p: string) => p.startsWith(`${base}/progress`) },
    { href: `${base}/strategy`, label: "Strategy", match: (p: string) => p.startsWith(`${base}/strategy`) },
    // Only the student's: the people they share with don't see it.
    ...(owner
      ? [
          { href: `${base}/profile`, label: "Profile", match: (p: string) => p.startsWith(`${base}/profile`) },
          { href: `${base}/counselor`, label: "Counselor", match: (p: string) => p.startsWith(`${base}/counselor`) },
        ]
      : []),
  ];
  return (
    <nav aria-label="Desk" className="flex flex-wrap items-center gap-1 rounded-lg bg-bg p-0.5 text-sm">
      {pages.map((p) => {
        const active = p.match(path);
        return (
          <Link
            key={p.label}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1 ${active ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {p.label}
          </Link>
        );
      })}
      {owner && (
        <Link
          href={`${base}/settings`}
          aria-current={path.startsWith(`${base}/settings`) ? "page" : undefined}
          className={`rounded-md px-3 py-1 ${path.startsWith(`${base}/settings`) ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          Settings
        </Link>
      )}
    </nav>
  );
}

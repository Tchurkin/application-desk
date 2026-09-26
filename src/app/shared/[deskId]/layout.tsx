import Link from "next/link";
import { DeskNav } from "@/components/desk-nav";
import { requireDeskAccess } from "@/lib/supabase/server";

/** A desk someone shared: its Board, Write and Strategy pages (the student's Profile, Counselor and Settings stay theirs). */
export default async function SharedLayout(props: LayoutProps<"/shared/[deskId]">) {
  const { deskId } = await props.params;
  const { desk, role, name } = await requireDeskAccess(deskId);
  const base = `/shared/${deskId}`;
  return (
    <div className="desk-shell flex min-h-screen flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2">
        <Link href={base} className="font-serif text-lg">{desk.title}</Link>
        <DeskNav base={base} owner={false} />
        <span className="flex items-center gap-3 text-sm text-muted">
          <span>
            {name ? `${name} · ` : ""}
            {role === "owner" ? "your desk" : role === "edit" ? "can edit" : role === "suggest" ? "can suggest" : "read only"}
          </span>
          {role !== "owner" && (
            <Link href="/?open" className="underline underline-offset-2 hover:text-ink">
              Open another desk
            </Link>
          )}
        </span>
      </header>
      <div className="desk-page flex-1">{props.children}</div>
    </div>
  );
}

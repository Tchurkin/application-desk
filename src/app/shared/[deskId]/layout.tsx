import Link from "next/link";
import { requireDeskAccess } from "@/lib/supabase/server";

export default async function SharedLayout(props: LayoutProps<"/shared/[deskId]">) {
  const { deskId } = await props.params;
  const { desk, role, name } = await requireDeskAccess(deskId);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
        <Link href={`/shared/${deskId}`} className="font-serif text-lg">{desk.title}</Link>
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
      <div className="flex-1">{props.children}</div>
    </div>
  );
}

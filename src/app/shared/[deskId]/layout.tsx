import Link from "next/link";
import { requireDeskAccess } from "@/lib/supabase/server";

export default async function SharedLayout(props: LayoutProps<"/shared/[deskId]">) {
  const { deskId } = await props.params;
  const { desk, role, name } = await requireDeskAccess(deskId);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
        <Link href={`/shared/${deskId}`} className="font-serif text-lg">{desk.title}</Link>
        <span className="text-sm text-muted">
          {name ? `${name} · ` : ""}
          {role === "owner" ? "your desk" : role === "suggest" ? "can suggest" : "read only"}
        </span>
      </header>
      <div className="flex-1">{props.children}</div>
    </div>
  );
}

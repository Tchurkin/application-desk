import Link from "next/link";
import { DeskNav } from "@/components/desk-nav";
import { DeskNotices } from "@/components/desk-notices";
import { requireDesk } from "@/lib/supabase/server";

export default async function DeskLayout({ children }: LayoutProps<"/desk">) {
  const { desk } = await requireDesk();
  return (
    <div className="desk-shell flex min-h-screen flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2">
        <Link href="/desk" className="font-serif text-lg">{desk.title}</Link>
        <DeskNav base="/desk" owner deskId={desk.id} />
        <form action="/auth/signout" method="post">
          <button className="text-sm text-muted hover:text-ink" type="submit">Sign out</button>
        </form>
      </header>
      <div className="desk-page flex-1">{children}</div>
      <DeskNotices deskId={desk.id} />
    </div>
  );
}

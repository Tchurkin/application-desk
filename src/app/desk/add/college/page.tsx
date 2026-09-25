import Link from "next/link";
import { CollegeFields } from "@/components/college-form";
import { requireDesk } from "@/lib/supabase/server";
import { addCollege } from "../../actions";

export const metadata = { title: "Add a college" };

export default async function AddCollegePage() {
  await requireDesk();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <nav className="mb-2 text-sm text-muted">
        <Link href="/desk">Board</Link>
      </nav>
      <h1 className="mb-1 font-serif text-3xl">Add a college</h1>
      <p className="mb-5 text-sm text-muted">
        Next you add the essays it asks for. Or ask Claude to set up all your colleges at once, with every prompt and word limit.
      </p>
      <form action={addCollege} className="card flex flex-col gap-4 px-4 py-4">
        <CollegeFields />
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit">Add college</button>
          <Link href="/desk" className="btn">Cancel</Link>
        </div>
      </form>
    </main>
  );
}

import { redirect } from "next/navigation";

/** Progress is part of the board now. */
export default function ProgressPage() {
  redirect("/desk");
}

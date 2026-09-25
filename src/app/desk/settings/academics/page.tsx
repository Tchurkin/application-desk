import { redirect } from "next/navigation";

/** Academics are on the Profile page now. */
export default function AcademicsSettingsPage() {
  redirect("/desk/profile#academics");
}

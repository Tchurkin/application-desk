import Link from "next/link";
import { H2, LegalPage, List } from "@/components/legal";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="September 25, 2026">
      <p>
        Average App is a free, open-source tool for writing college essays and keeping track of applications. By using it you agree
        to these terms, and to how we handle your information in the{" "}
        <Link className="text-accent underline underline-offset-2" href="/privacy">
          privacy policy
        </Link>
        .
      </p>

      <H2>Who can use it</H2>
      <p>
        You need to be at least 13. If you&apos;re under 18, you need a parent&apos;s or guardian&apos;s permission. Keep your
        sign-in to yourself; you&apos;re responsible for what happens on your account.
      </p>

      <H2>Your writing is yours</H2>
      <p>
        You own everything you put on your desk. You give us permission only to store it, show it to you and the people you share it
        with, and pass it to the AI you connect, because that&apos;s what the site does. We don&apos;t use it for anything else.
      </p>

      <H2>Sharing and AI are your call</H2>
      <p>
        You choose who gets a share link and what a connected AI may do, and you&apos;re responsible for those choices. A link is its
        own key, so keep links private and turn them off when you&apos;re done. AI suggestions and odds estimates can be wrong: odds
        are guesses, not predictions from any college.
      </p>

      <H2>Your applications are your own work</H2>
      <p>
        Colleges and application platforms have their own rules about outside help and AI, and you agree to follow them. Average App
        can note a college&apos;s AI rule, but it doesn&apos;t enforce it. What you submit is up to you.
      </p>

      <H2>Don&apos;t misuse it</H2>
      <List>
        <li>Don&apos;t get into anyone else&apos;s account or desk without their permission.</li>
        <li>Don&apos;t try to break, overload or get around the site&apos;s security.</li>
        <li>Don&apos;t put anything on it that&apos;s illegal or that you don&apos;t have the right to share.</li>
        <li>Don&apos;t use it to harass anyone.</li>
      </List>

      <H2>No guarantees</H2>
      <p>
        Average App is free and provided as is, without warranties of any kind. It may have bugs, lose data or be unavailable, and
        deadlines, prompts or requirements shown on it may be wrong. Check them with each college, and keep your own copies (Settings
        → Account → Download all my writing).
      </p>
      <p>
        As far as the law allows, we aren&apos;t liable for lost writing, missed deadlines, admission decisions, or any indirect
        damages from using Average App.
      </p>

      <H2>Ending</H2>
      <p>
        You can delete your account whenever you want, in Settings → Account. We may suspend an account that breaks these terms. If
        Average App ever shuts down, we&apos;ll try to give notice so you can download your writing first.
      </p>

      <H2>Open source</H2>
      <p>
        The code is available under the MIT License on{" "}
        <a className="text-accent underline underline-offset-2" href="https://github.com/Tchurkin/margin-application-desk">
          GitHub
        </a>
        . These terms cover this site, averageapp.com, not copies other people run.
      </p>

      <H2>Changes</H2>
      <p>If these terms change, the new version goes here with a new date at the top.</p>
    </LegalPage>
  );
}

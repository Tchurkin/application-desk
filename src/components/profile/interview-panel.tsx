"use client";

import { DeskThread } from "@/components/thread/desk-thread";

/*
 * The interview on the Profile page. Starting it, and each answer, queues an "interview"
 * request on the desk; the counselor (or a watching chat) saves what it learned into the
 * profile's sections and answers with its next question, which arrives here live.
 */

const CHAT_PHRASE = "Interview me for my Application Desk profile";

export function InterviewPanel({ deskId }: { deskId: string }) {
  return (
    <DeskThread
      deskId={deskId}
      kind="interview"
      title="Interview"
      intro={
        <>
          Claude asks you one question at a time and writes what you say into your profile, in your words. Answer in as much detail as
          you like; skip anything. You can also do this in a Claude chat: say &ldquo;{CHAT_PHRASE}&rdquo;.
        </>
      }
      inputLabel="Your answer"
      placeholder="Your answer…"
      sendLabel="Send answer"
      startedLabel="You started the interview"
      clearQuestion="Clear this interview? Your profile stays."
      empty={(send, busy) => (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send("")}>
          Start the interview
        </button>
      )}
      testId="interview"
      className="max-h-[80vh] min-h-80"
    />
  );
}

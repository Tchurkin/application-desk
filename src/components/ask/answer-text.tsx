import { Fragment } from "react";
import { parseAnswer, type Line } from "@/lib/bridge/answer-format";

/** One line of spans. Every piece is a text node: an answer can never inject markup. */
function Spans({ line }: { line: Line }) {
  return line.map((s, i) => {
    if (s.code) return <code key={i} className="rounded bg-bg px-1 font-mono text-[0.85em]">{s.text}</code>;
    if (s.bold) return <strong key={i} className="font-semibold">{s.text}</strong>;
    if (s.italic) return <em key={i}>{s.text}</em>;
    return <Fragment key={i}>{s.text}</Fragment>;
  });
}

function Lines({ lines }: { lines: Line[] }) {
  return lines.map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      <Spans line={l} />
    </Fragment>
  ));
}

/** The assistant's answer: paragraphs, bold, lists and quotes, rendered as elements. `large` where it's the page's subject (the Counselor chat). */
export function AnswerText({ text, large = false }: { text: string; large?: boolean }) {
  const blocks = parseAnswer(text);
  if (!blocks.length) return <p className="text-sm text-muted italic">(an empty answer)</p>;
  return (
    <div className={`flex flex-col gap-2 leading-relaxed break-words ${large ? "text-[15px]" : "text-sm"}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <p key={i} className="font-semibold">
                <Spans line={b.spans} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-line pl-2 text-muted">
                <Lines lines={b.lines} />
              </blockquote>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Spans line={it} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={b.start} className="list-decimal pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Spans line={it} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i}>
                <Lines lines={b.lines} />
              </p>
            );
        }
      })}
    </div>
  );
}

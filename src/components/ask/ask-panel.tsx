"use client";

/**
 * The Ask panel: questions and "polish this passage" requests for the connected AI, answered
 * through the connector and shown here live. (Being built.)
 *
 * Contract used by the Write workspace:
 *   <AskPanel deskId pieceId pieceTitle getSelection />
 * - getSelection() returns the text currently selected in the editor ("" if none), used to
 *   point the AI at a passage or to ask for rewordings of it.
 */
export interface AskPanelProps {
  deskId: string;
  pieceId: string;
  pieceTitle: string;
  getSelection: () => string;
}

export function AskPanel(props: AskPanelProps) {
  void props;
  return <p className="text-sm text-muted">Ask is coming soon.</p>;
}

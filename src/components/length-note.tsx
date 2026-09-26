/**
 * How close a message is to its limit, once it's close; over it, why it can't go. A box that
 * cut a long paste off at its limit without saying so lost most of it (a pasted profile).
 */
export function LengthNote({ length, max, over }: { length: number; max: number; over: string }) {
  if (length <= max * 0.9) return null;
  const tooLong = length > max;
  return (
    <p role={tooLong ? "alert" : undefined} className={`text-xs ${tooLong ? "text-danger" : "text-muted"}`} data-testid="length-note">
      {length.toLocaleString("en-US")} of {max.toLocaleString("en-US")} characters.{tooLong && ` Too long to send as one message: ${over}`}
    </p>
  );
}

/**
 * Commit signatures, matching the semantics of libgit2's `git_signature_*` functions that the previous
 * nodegit-based implementation used.
 */

export interface Signature {
  name: string;
  email: string;
  /** Seconds since the Unix epoch. */
  time: number;
  /** Timezone offset from UTC, in minutes. */
  offset: number;
  /** Sign of the offset. Only matters to distinguish `-0000` from `+0000`. */
  sign: '+' | '-';
}

/** Signature as accepted in options: `{ name, email }` uses the current time, add `time` and `offset` to pin it. */
export interface SignatureInput {
  name: string;
  email: string;
  /** Seconds since the Unix epoch. */
  time?: number;
  /** Timezone offset from UTC, in minutes. */
  offset?: number;
}

function isCrud(c: string): boolean {
  return c.charCodeAt(0) <= 32 || '.,:;<>"\\\''.includes(c);
}

/** libgit2's `extract_trimmed`: strip "crud" characters from both ends. */
function extractTrimmed(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isCrud(s[start]!)) start++;
  while (end > start && isCrud(s[end - 1]!)) end--;
  return s.slice(start, end);
}

function signatureError(msg: string): Error {
  return Error(`failed to parse signature - ${msg}`);
}

/** `git_signature_new` */
export function createSignature(name: string, email: string, time: number, offset: number): Signature {
  if (/[<>]/.test(name) || /[<>]/.test(email)) {
    throw signatureError('Neither `name` nor `email` should contain angle brackets chars.');
  }
  // Newlines would corrupt the commit object. libgit2 trims them from the ends via extractTrimmed; reject inner ones.
  name = extractTrimmed(name);
  email = extractTrimmed(email);
  if (!name || !email) throw signatureError('Signature cannot have an empty name or email');
  if (/[\r\n\0]/.test(name) || /[\r\n\0]/.test(email)) {
    throw signatureError('Neither `name` nor `email` should contain newlines.');
  }
  return { name, email, time, offset, sign: offset < 0 ? '-' : '+' };
}

/** `git_signature_now`: current time and local timezone offset. */
export function signatureNow(name: string, email: string, now = new Date()): Signature {
  return createSignature(name, email, Math.floor(now.getTime() / 1000), -now.getTimezoneOffset());
}

/**
 * `git_signature_from_buffer`: parse `Name <email> [unix-time [+hhmm]]`.
 *
 * As in libgit2, a missing time means `0` (the Unix epoch) and a missing or malformed timezone means `+0000`.
 */
export function parseSignature(buffer: string): Signature {
  const emailStart = buffer.lastIndexOf('<');
  const emailEnd = buffer.lastIndexOf('>');
  if (emailStart < 0 || emailEnd < 0 || emailEnd <= emailStart) throw signatureError('malformed e-mail');

  const name = extractTrimmed(buffer.slice(0, emailStart));
  const email = extractTrimmed(buffer.slice(emailStart + 1, emailEnd));

  let time = 0;
  let offset = 0;
  let sign: '+' | '-' = '+';

  const rest = buffer.slice(emailEnd + 2);
  if (rest.length) {
    const timeMatch = /^\s*([+-]?\d+)/.exec(rest);
    if (!timeMatch) throw signatureError('invalid Unix timestamp');
    time = Number(timeMatch[1]);

    const tz = rest.slice(timeMatch[0].length + 1);
    if (tz.length) {
      // Malformed timezone: assume zero (but, like libgit2, still remember a leading '-').
      const tzMatch = /^[+-]\s*([+-]?\d+)/.exec(tz);
      const value = tzMatch ? Number(tzMatch[1]) : 0;
      const hours = Math.trunc(value / 100);
      const mins = value % 100;
      if (hours <= 14 && mins <= 59) {
        offset = hours * 60 + mins;
        sign = tz[0] === '-' ? '-' : '+';
        if (sign === '-') offset = -offset;
      }
    }
  }

  if (/[\r\n\0]/.test(name) || /[\r\n\0]/.test(email)) {
    throw signatureError('Neither `name` nor `email` should contain newlines.');
  }

  return { name, email, time, offset, sign };
}

/** Format as it appears in a commit object header: `Name <email> 1234567890 -0800` (`git_signature__writebuf`). */
export function formatSignature(sig: Signature): string {
  const sign = sig.offset < 0 || sig.sign === '-' ? '-' : '+';
  const abs = Math.abs(sig.offset);
  const hh = String(Math.trunc(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sig.name} <${sig.email}> ${sig.time} ${sign}${hh}${mm}`;
}

/** nodegit's `Signature#toString()`: `Name <email>`. */
export function signatureToString(sig: Signature): string {
  return `${sig.name} <${sig.email}>`;
}

import * as crypto from "crypto";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 8;

/** `id`: 8-char [A-Z0-9], per docs/design-notes.md "문서 스키마". */
export function generateDocumentId(): string {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

export function trackingCode(kind: string, id: string): string {
  return `${kind}-${id}`;
}

const TRACKING_CODE_RE = /^([A-Z]{2,3})-([A-Z0-9]{8})$/;

export function parseTrackingCode(code: string): { kind: string; id: string } | null {
  const match = TRACKING_CODE_RE.exec(code);
  if (!match) return null;
  return { kind: match[1], id: match[2] };
}

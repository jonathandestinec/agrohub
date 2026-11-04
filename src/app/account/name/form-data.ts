import type { NameDocumentKind } from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors";
import type { NameChangeFile, NameChangeInput } from "@/modules/name-changes/schema";

const KINDS: readonly NameDocumentKind[] = [
  "AFFIDAVIT",
  "MARRIAGE_CERTIFICATE",
  "PUBLIC_NOTICE",
  "AMENDED_REGISTRATION_CERTIFICATE",
];

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

// Reads the request form shared by /account/name and the officer's cooperative page. The
// service checks which kinds fit the subject, and the file's type, size and bytes.
export async function nameChangeFromForm(
  form: FormData,
): Promise<{ input: NameChangeInput; file: NameChangeFile }> {
  const kind = KINDS.find((k) => k === text(form, "documentKind"));
  if (!kind) throw new ValidationError("Unknown document kind", "INVALID_DOCUMENT_KIND");
  const document = form.get("document");
  if (!(document instanceof File) || document.size === 0) {
    throw new ValidationError("No file", "NO_FILE");
  }
  return {
    input: { newName: text(form, "newName"), reason: text(form, "reason") },
    file: {
      kind,
      body: Buffer.from(await document.arrayBuffer()),
      contentType: document.type,
    },
  };
}

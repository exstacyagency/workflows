type ParsedUploadRow = {
  text: string;
  source?: string;
  date?: string | null;
  metadata?: Record<string, unknown>;
};

const MIN_TEXT_LENGTH = 20;
const TEXT_KEYS = ["text", "content", "body", "review", "comment", "message"];

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitIntoChunks(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function coerceRow(
  text: string,
  source?: string,
  date?: string | null,
  metadata?: Record<string, unknown>,
): ParsedUploadRow | null {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length < MIN_TEXT_LENGTH) return null;
  const row: ParsedUploadRow = { text: normalized };
  if (source !== undefined) row.source = source;
  if (date !== undefined) row.date = date;
  if (metadata !== undefined) row.metadata = metadata;
  return row;
}

export function parsePlainText(text: string): ParsedUploadRow[] {
  return splitIntoChunks(text)
    .map((chunk) => coerceRow(chunk, "UPLOADED"))
    .filter((row): row is ParsedUploadRow => row !== null);
}

export async function parseCSV(text: string): Promise<ParsedUploadRow[]> {
  const PapaModule = await import("papaparse");
  const Papa = (PapaModule as any).default ?? PapaModule;
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed?.errors?.length) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message || "unknown error"}`);
  }

  const rows = (parsed?.data || []) as Record<string, unknown>[];
  return rows
    .map((row) => {
      const textValue =
        (typeof row.text === "string" && row.text) ||
        (typeof row.content === "string" && row.content) ||
        (typeof row.body === "string" && row.body) ||
        "";
      const source = typeof row.source === "string" ? row.source : undefined;
      const date = typeof row.date === "string" ? row.date : null;
      return coerceRow(textValue, source, date, { ...row });
    })
    .filter((row): row is ParsedUploadRow => row !== null);
}

function rowsFromJsonValue(value: unknown): ParsedUploadRow[] {
  if (value == null) return [];

  if (typeof value === "string") {
    const row = coerceRow(value);
    return row ? [row] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => rowsFromJsonValue(entry));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const matchedKey = TEXT_KEYS.find(
      (key) => typeof obj[key] === "string" && String(obj[key]).trim()
    );
    const text = matchedKey ? String(obj[matchedKey]) : "";
    const source = typeof obj.source === "string" ? obj.source : undefined;
    const date = typeof obj.date === "string" ? obj.date : null;
    const row = coerceRow(text, source, date, obj);
    const nested = Object.values(obj).flatMap((entry) => rowsFromJsonValue(entry));
    return row ? [row, ...nested] : nested;
  }

  return [];
}

export function parseJSON(text: string): ParsedUploadRow[] {
  const parsed = JSON.parse(text);
  const rows = rowsFromJsonValue(parsed);
  return rows.map((row) => ({
    ...row,
    source: row.source || "UPLOADED",
  }));
}

export async function extractTextFromFile(file: File, typeHint?: string | null): Promise<ParsedUploadRow[]> {
  const filename = file.name.toLowerCase();
  const ext = filename.split(".").pop() || "";
  const type = (typeHint || file.type || "").toLowerCase();

  if (ext === "csv" || type.includes("csv")) {
    return parseCSV(await file.text());
  }

  if (ext === "json" || type.includes("json")) {
    return parseJSON(await file.text());
  }

  if (ext === "pdf" || type.includes("pdf")) {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdfParse(buffer);
    return parsePlainText(pdfData?.text || "");
  }

  if (ext === "docx" || type.includes("word")) {
    const mammothModule = await import("mammoth");
    const mammoth = (mammothModule as any).default ?? mammothModule;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    return parsePlainText(result?.value || "");
  }

  return parsePlainText(await file.text());
}

export type { ParsedUploadRow };

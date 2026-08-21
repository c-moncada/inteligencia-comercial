/**
 * Lectura de archivos de texto tabular sin exigir un formato previo:
 * detecta el separador, ignora membretes y encuentra la fila de encabezados.
 */

import { parse } from "csv-parse/sync";
import { cleanText } from "./decode.js";
import type { RawTable } from "./table.js";
import { normalizeText, parseDate, parseNumber } from "./values.js";

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|", ":", "~"];
const MAX_HEADER_SEARCH_ROWS = 25;

function parseWith(text: string, delimiter: string): string[][] | null {
  try {
    const rows = parse(text, {
      delimiter,
      columns: false,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as string[][];
    return rows;
  } catch {
    return null;
  }
}

function scoreRows(rows: string[][]): number {
  const sample = rows.slice(0, 60).filter((row) => row.some((cell) => cell !== ""));
  if (sample.length === 0) return 0;

  const counts = new Map<number, number>();
  for (const row of sample) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);

  let modalCount = 0;
  let modalFrequency = 0;
  for (const [count, frequency] of counts) {
    if (frequency > modalFrequency || (frequency === modalFrequency && count > modalCount)) {
      modalCount = count;
      modalFrequency = frequency;
    }
  }

  if (modalCount < 2) return 0;
  const consistency = modalFrequency / sample.length;
  return consistency * Math.min(modalCount, 12);
}

function splitFixedWidth(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s{2,}|\t+/).map((cell) => cell.trim()));
}

/** Elige el separador que produce la tabla más consistente. */
export function detectDelimiter(text: string): { delimiter: string; rows: string[][] } {
  const sample = text.split("\n").slice(0, 200).join("\n");

  let bestDelimiter = ",";
  let bestRows: string[][] = [];
  let bestScore = 0;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const rows = parseWith(sample, delimiter);
    if (!rows) continue;
    const score = scoreRows(rows);
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
      bestRows = rows;
    }
  }

  if (bestScore < 1.5) {
    const fixed = splitFixedWidth(sample);
    if (scoreRows(fixed) > bestScore) return { delimiter: " ", rows: fixed };
  }

  return { delimiter: bestDelimiter, rows: bestRows };
}

function looksLikeValue(cell: string): boolean {
  const text = normalizeText(cell);
  if (!text) return false;
  if (parseNumber(text) !== null) return true;
  if (parseDate(text, "dmy") !== null) return true;
  return false;
}

/**
 * Busca la fila de encabezados: la primera que tenga suficientes celdas de
 * texto, sin repeticiones y con datos debajo. Devuelve -1 si el archivo no
 * trae encabezados.
 */
export function detectHeaderRow(rows: string[][]): number {
  const widths = rows.slice(0, 60).map((row) => row.filter((cell) => cell !== "").length);
  const maxWidth = Math.max(1, ...widths);

  let bestIndex = -1;
  let bestScore = 0;

  const limit = Math.min(rows.length, MAX_HEADER_SEARCH_ROWS);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    const filled = row.filter((cell) => normalizeText(cell) !== "");
    if (filled.length < 2) continue;

    const textCells = filled.filter((cell) => !looksLikeValue(cell)).length;
    const textFraction = textCells / filled.length;
    if (textFraction < 0.6) continue;

    const unique = new Set(filled.map((cell) => normalizeText(cell).toLowerCase()));
    const uniqueFraction = unique.size / filled.length;
    const coverage = filled.length / maxWidth;
    const hasDataBelow = rows.length > index + 1;
    if (!hasDataBelow) continue;

    const score =
      textFraction * 0.45 +
      uniqueFraction * 0.3 +
      coverage * 0.25 -
      index * 0.01;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 0.6 ? bestIndex : -1;
}

function makeHeaders(row: string[] | null, width: number): string[] {
  const headers: string[] = [];
  const used = new Map<string, number>();

  for (let index = 0; index < width; index += 1) {
    const raw = row ? normalizeText(row[index]) : "";
    const base = raw || `columna_${index + 1}`;
    const seen = used.get(base.toLowerCase()) ?? 0;
    used.set(base.toLowerCase(), seen + 1);
    headers.push(seen === 0 ? base : `${base} (${seen + 1})`);
  }

  return headers;
}

/** Convierte una matriz de celdas en una tabla con encabezados detectados. */
export function buildTable(
  rows: string[][],
  meta: Omit<RawTable, "headers" | "rows" | "headerLine" | "skippedLines">,
): RawTable | null {
  const usable = rows.filter((row) => row.some((cell) => normalizeText(cell) !== ""));
  if (usable.length === 0) return null;

  const headerIndex = detectHeaderRow(usable);
  const headerRow = headerIndex >= 0 ? usable[headerIndex] : null;
  const dataRows = usable.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  if (dataRows.length === 0) return null;

  const width = Math.max(
    headerRow ? headerRow.length : 0,
    ...dataRows.slice(0, 200).map((row) => row.length),
  );

  const headers = makeHeaders(headerRow, width);
  const normalized = dataRows.map((row) => {
    const cells = new Array<string>(width);
    for (let index = 0; index < width; index += 1) cells[index] = normalizeText(row[index]);
    return cells;
  });

  return {
    ...meta,
    headers,
    rows: normalized,
    headerLine: headerIndex >= 0 ? headerIndex + 1 : 0,
    skippedLines: headerIndex > 0 ? headerIndex : 0,
  };
}

/** Lee texto delimitado en cualquier separador y devuelve una tabla. */
export function readDelimitedText(
  text: string,
  source: string,
  encoding: string,
): RawTable | null {
  const clean = cleanText(text);
  if (!clean.trim()) return null;

  const { delimiter } = detectDelimiter(clean);
  const rows =
    delimiter === " " ? splitFixedWidth(clean) : parseWith(clean, delimiter) ?? [];

  return buildTable(rows, {
    source,
    format: "delimitado",
    encoding,
    delimiter,
  });
}

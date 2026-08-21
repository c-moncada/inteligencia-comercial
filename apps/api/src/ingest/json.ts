/** Lectura de JSON y JSON por líneas (NDJSON) en cualquier forma razonable. */

import type { RawTable } from "./table.js";
import { normalizeText } from "./values.js";

type JsonValue = unknown;

function flatten(value: Record<string, JsonValue>, prefix = ""): Record<string, string> {
  const flat: Record<string, string> = {};

  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;

    if (item === null || item === undefined) {
      flat[name] = "";
    } else if (Array.isArray(item)) {
      flat[name] = item.map((entry) => normalizeText(entry)).join(" | ");
    } else if (typeof item === "object") {
      Object.assign(flat, flatten(item as Record<string, JsonValue>, name));
    } else if (typeof item === "boolean") {
      flat[name] = item ? "1" : "0";
    } else {
      flat[name] = normalizeText(item);
    }
  }

  return flat;
}

function tableFromObjects(
  records: Record<string, JsonValue>[],
  source: string,
  sheet?: string,
): RawTable | null {
  const flattened = records
    .filter((record) => record && typeof record === "object" && !Array.isArray(record))
    .map((record) => flatten(record));
  if (flattened.length === 0) return null;

  const headers: string[] = [];
  for (const record of flattened.slice(0, 500)) {
    for (const key of Object.keys(record)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  if (headers.length === 0) return null;

  return {
    source,
    sheet,
    format: "json",
    encoding: "utf-8",
    headers,
    rows: flattened.map((record) => headers.map((header) => record[header] ?? "")),
    headerLine: 0,
    skippedLines: 0,
  };
}

function tableFromMatrix(
  columns: string[],
  data: JsonValue[][],
  source: string,
  sheet?: string,
): RawTable | null {
  if (columns.length === 0 || data.length === 0) return null;
  return {
    source,
    sheet,
    format: "json",
    encoding: "utf-8",
    headers: columns.map((column) => normalizeText(column)),
    rows: data.map((row) => columns.map((_, index) => normalizeText(row[index]))),
    headerLine: 0,
    skippedLines: 0,
  };
}

function parseJsonText(text: string): JsonValue | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    // NDJSON: un objeto por línea.
    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
    const records: JsonValue[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line.replace(/,$/, "")) as JsonValue);
      } catch {
        return null;
      }
    }
    return records.length > 0 ? records : null;
  }
}

/** Convierte cualquier JSON tabular en una o varias tablas. */
export function readJson(text: string, source: string): RawTable[] {
  const parsed = parseJsonText(text);
  if (parsed === null) return [];

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && Array.isArray(parsed[0])) {
      const [head, ...rest] = parsed as JsonValue[][];
      const table = tableFromMatrix(head.map((cell) => normalizeText(cell)), rest, source);
      return table ? [table] : [];
    }
    const table = tableFromObjects(parsed as Record<string, JsonValue>[], source);
    return table ? [table] : [];
  }

  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, JsonValue>;

    if (Array.isArray(record.columns) && Array.isArray(record.data)) {
      const table = tableFromMatrix(
        (record.columns as JsonValue[]).map((column) => normalizeText(column)),
        record.data as JsonValue[][],
        source,
      );
      return table ? [table] : [];
    }

    const tables: RawTable[] = [];
    for (const [key, value] of Object.entries(record)) {
      if (!Array.isArray(value) || value.length === 0) continue;

      if (Array.isArray(value[0])) {
        const [head, ...rest] = value as JsonValue[][];
        const table = tableFromMatrix(
          head.map((cell) => normalizeText(cell)),
          rest,
          source,
          key,
        );
        if (table) tables.push(table);
        continue;
      }

      const table = tableFromObjects(value as Record<string, JsonValue>[], source, key);
      if (table) tables.push(table);
    }

    if (tables.length > 0) return tables;

    const single = tableFromObjects([record], source);
    return single ? [single] : [];
  }

  return [];
}

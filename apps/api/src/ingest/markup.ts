/**
 * Lectura de exportaciones en HTML y XML.
 *
 * Varios sistemas administrativos generan archivos con extensión .xls que en
 * realidad son tablas HTML, o exportan XML con una etiqueta por registro.
 */

import type { RawTable } from "./table.js";
import { buildTable } from "./tabular.js";
import { normalizeText } from "./values.js";

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return normalizeText(decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")));
}

export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 4000).toLowerCase();
  return head.includes("<table") || head.includes("<!doctype html") || head.includes("<html");
}

export function looksLikeXml(text: string): boolean {
  const head = text.slice(0, 400).trimStart().toLowerCase();
  return head.startsWith("<?xml") || /^<[a-z_][\w:.-]*[\s>]/.test(head);
}

/** Extrae cada <table> del documento como una tabla independiente. */
export function readHtmlTables(text: string, source: string, encoding: string): RawTable[] {
  const tables: RawTable[] = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;

  let match: RegExpExecArray | null;
  let position = 1;
  while ((match = tablePattern.exec(text)) !== null) {
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(match[1])) !== null) {
      const cellPattern = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[2]));
      }
      if (cells.length > 0) rows.push(cells);
    }

    const table = buildTable(rows, {
      source,
      sheet: `tabla ${position}`,
      format: "texto",
      encoding,
    });
    if (table) tables.push(table);
    position += 1;
  }

  return tables;
}

/**
 * Convierte XML en tabla: se busca la etiqueta que más se repite con hijos
 * simples y cada repetición se trata como una fila.
 */
export function readXmlRecords(text: string, source: string, encoding: string): RawTable[] {
  const blockPattern = /<([\w:.-]+)\b[^>]*>([\s\S]*?)<\/\1>/g;
  const groups = new Map<string, Record<string, string>[]>();

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const name = match[1];
    const body = match[2];
    if (/<[\w:.-]+\b[^>]*>[\s\S]*<[\w:.-]+\b[^>]*>/.test(body) === false && !body.includes("<")) {
      continue;
    }

    const fields: Record<string, string> = {};
    const fieldPattern = /<([\w:.-]+)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let field: RegExpExecArray | null;
    let hasNested = false;

    while ((field = fieldPattern.exec(body)) !== null) {
      const value = field[3] ?? "";
      if (/<[\w:.-]+/.test(value)) {
        hasNested = true;
        break;
      }
      const key = field[1].replace(/^.*:/, "");
      fields[key] = normalizeText(decodeEntities(value));
    }

    if (hasNested || Object.keys(fields).length < 2) continue;

    const list = groups.get(name) ?? [];
    list.push(fields);
    groups.set(name, list);
  }

  let bestName = "";
  let bestRecords: Record<string, string>[] = [];
  for (const [name, records] of groups) {
    if (records.length > bestRecords.length) {
      bestName = name;
      bestRecords = records;
    }
  }

  if (bestRecords.length === 0) return [];

  const headers: string[] = [];
  for (const record of bestRecords) {
    for (const key of Object.keys(record)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }

  return [
    {
      source,
      sheet: bestName,
      format: "texto",
      encoding,
      headers,
      rows: bestRecords.map((record) => headers.map((header) => record[header] ?? "")),
      headerLine: 0,
      skippedLines: 0,
    },
  ];
}

/** Lee el XML de hoja de cálculo de Excel 2003 (SpreadsheetML). */
export function readSpreadsheetXml(
  text: string,
  source: string,
  encoding: string,
): RawTable[] {
  const tables: RawTable[] = [];
  const worksheetPattern = /<Worksheet\b([^>]*)>([\s\S]*?)<\/Worksheet>/gi;

  let sheetMatch: RegExpExecArray | null;
  let position = 1;
  while ((sheetMatch = worksheetPattern.exec(text)) !== null) {
    const nameMatch = sheetMatch[1].match(/ss:Name\s*=\s*"([^"]*)"/i);
    const rows: string[][] = [];
    const rowPattern = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(sheetMatch[2])) !== null) {
      const cells: string[] = [];
      const cellPattern = /<Cell\b([^>]*)(?:\/>|>([\s\S]*?)<\/Cell>)/gi;

      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        const indexMatch = cellMatch[1].match(/ss:Index\s*=\s*"(\d+)"/i);
        if (indexMatch) {
          while (cells.length < Number(indexMatch[1]) - 1) cells.push("");
        }
        const dataMatch = (cellMatch[2] ?? "").match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
        cells.push(dataMatch ? stripTags(dataMatch[1]) : "");
      }

      if (cells.length > 0) rows.push(cells);
    }

    const table = buildTable(rows, {
      source,
      sheet: nameMatch ? nameMatch[1] : `Hoja ${position}`,
      format: "excel",
      encoding,
    });
    if (table) tables.push(table);
    position += 1;
  }

  return tables;
}

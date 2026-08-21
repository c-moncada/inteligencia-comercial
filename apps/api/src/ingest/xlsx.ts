/**
 * Lector de archivos Excel (.xlsx / .xlsm) sin dependencias externas.
 *
 * Un libro de Excel es un ZIP con XML adentro. Aquí se descomprime el ZIP con
 * zlib (incluido en Node) y se recorren las hojas para devolver celdas de texto,
 * convirtiendo las fechas seriales de Excel a formato ISO.
 */

import { inflateRawSync } from "node:zlib";
import type { RawTable } from "./table.js";
import { buildTable } from "./tabular.js";
import { excelSerialToIso } from "./values.js";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;

const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 66_000);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error("El archivo de Excel no tiene una estructura ZIP válida.");

  let entryCount = buffer.readUInt16LE(eocd + 10);
  let directoryOffset = buffer.readUInt32LE(eocd + 16);

  const locatorOffset = eocd - 20;
  if (
    locatorOffset >= 0 &&
    buffer.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE
  ) {
    const zip64Offset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
    if (
      zip64Offset >= 0 &&
      zip64Offset + 56 <= buffer.length &&
      buffer.readUInt32LE(zip64Offset) === ZIP64_EOCD_SIGNATURE
    ) {
      entryCount = Number(buffer.readBigUInt64LE(zip64Offset + 32));
      directoryOffset = Number(buffer.readBigUInt64LE(zip64Offset + 48));
    }
  }

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    let localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (localOffset === 0xffffffff) {
      const extraStart = cursor + 46 + nameLength;
      let extraCursor = extraStart;
      while (extraCursor + 4 <= extraStart + extraLength) {
        const fieldId = buffer.readUInt16LE(extraCursor);
        const fieldSize = buffer.readUInt16LE(extraCursor + 2);
        if (fieldId === 0x0001 && fieldSize >= 8) {
          localOffset = Number(buffer.readBigUInt64LE(extraCursor + 4 + fieldSize - 8));
        }
        extraCursor += 4 + fieldSize;
      }
    }

    entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const header = entry.localOffset;
  if (header + 30 > buffer.length) throw new Error("Entrada de Excel dañada.");

  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const end = entry.compressedSize > 0 ? start + entry.compressedSize : buffer.length;
  const data = buffer.subarray(start, Math.min(end, buffer.length));

  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`El archivo de Excel usa una compresión no soportada (${entry.method}).`);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return match ? decodeXmlEntities(match[1]) : null;
}

function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;

  let item: RegExpExecArray | null;
  while ((item = itemPattern.exec(xml)) !== null) {
    const body = item[1] ?? "";
    let text = "";
    let piece: RegExpExecArray | null;
    textPattern.lastIndex = 0;
    while ((piece = textPattern.exec(body)) !== null) text += decodeXmlEntities(piece[1]);
    strings.push(text);
  }

  return strings;
}

function readDateStyles(xml: string): Set<number> {
  const dateFormats = new Set<number>(BUILT_IN_DATE_FORMATS);

  const customPattern = /<numFmt\b[^>]*\/>/g;
  let custom: RegExpExecArray | null;
  while ((custom = customPattern.exec(xml)) !== null) {
    const id = Number(attribute(custom[0], "numFmtId"));
    const code = attribute(custom[0], "formatCode") ?? "";
    const withoutLiterals = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
    if (Number.isFinite(id) && /[dmyhs]/i.test(withoutLiterals) && /[dy]/i.test(withoutLiterals)) {
      dateFormats.add(id);
    }
  }

  const dateStyles = new Set<number>();
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return dateStyles;

  const xfPattern = /<xf\b[^>]*\/?>/g;
  let xf: RegExpExecArray | null;
  let index = 0;
  while ((xf = xfPattern.exec(cellXfs[1])) !== null) {
    const numberFormat = Number(attribute(xf[0], "numFmtId") ?? "0");
    if (dateFormats.has(numberFormat)) dateStyles.add(index);
    index += 1;
  }

  return dateStyles;
}

function columnIndexFromReference(reference: string | null, fallback: number): number {
  if (!reference) return fallback;
  const letters = reference.match(/^([A-Z]+)/);
  if (!letters) return fallback;

  let index = 0;
  for (const character of letters[1]) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function readSheet(xml: string, sharedStrings: string[], dateStyles: Set<number>): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellPattern = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const body = rowMatch[1] ?? "";
    const cells: string[] = [];
    let fallbackIndex = 0;

    let cellMatch: RegExpExecArray | null;
    cellPattern.lastIndex = 0;
    while ((cellMatch = cellPattern.exec(body)) !== null) {
      const attributes = cellMatch[1] ?? cellMatch[2] ?? "";
      const content = cellMatch[3] ?? "";
      const tag = `<c ${attributes}>`;
      const index = columnIndexFromReference(attribute(tag, "r"), fallbackIndex);
      fallbackIndex = index + 1;

      const type = attribute(tag, "t") ?? "n";
      const style = Number(attribute(tag, "s") ?? "-1");

      let value = "";
      if (type === "inlineStr") {
        const inline = content.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
        value = inline
          .map((piece) => decodeXmlEntities(piece.replace(/<[^>]+>/g, "")))
          .join("");
      } else {
        const raw = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const text = raw ? decodeXmlEntities(raw[1]) : "";

        if (type === "s") {
          value = sharedStrings[Number(text)] ?? "";
        } else if (type === "b") {
          value = text === "1" ? "1" : "0";
        } else if (type === "e") {
          value = "";
        } else if (type === "d") {
          value = text.slice(0, 10);
        } else {
          const numeric = Number(text);
          if (text !== "" && Number.isFinite(numeric) && dateStyles.has(style)) {
            value = excelSerialToIso(numeric) ?? text;
          } else {
            value = text;
          }
        }
      }

      while (cells.length < index) cells.push("");
      cells[index] = value;
    }

    rows.push(cells);
  }

  return rows;
}

function sheetTargets(workbookXml: string, relsXml: string): { name: string; path: string }[] {
  const relations = new Map<string, string>();
  const relationPattern = /<Relationship\b[^>]*\/>/g;
  let relation: RegExpExecArray | null;
  while ((relation = relationPattern.exec(relsXml)) !== null) {
    const id = attribute(relation[0], "Id");
    const target = attribute(relation[0], "Target");
    if (id && target) relations.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sheets: { name: string; path: string }[] = [];
  const sheetPattern = /<sheet\b[^>]*\/?>/g;
  let sheet: RegExpExecArray | null;
  let position = 1;
  while ((sheet = sheetPattern.exec(workbookXml)) !== null) {
    const name = attribute(sheet[0], "name") ?? `Hoja ${position}`;
    const id = attribute(sheet[0], "r:id") ?? attribute(sheet[0], "id");
    const target = id ? relations.get(id) : undefined;
    sheets.push({ name, path: `xl/${target ?? `worksheets/sheet${position}.xml`}` });
    position += 1;
  }

  return sheets;
}

/** Devuelve true si el archivo parece un libro de Excel moderno (ZIP). */
export function isXlsxBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Devuelve true si el archivo es un Excel antiguo (.xls binario). */
export function isLegacyXlsBuffer(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

/** Lee todas las hojas con datos de un archivo .xlsx. */
export function readXlsx(buffer: Buffer, source: string): RawTable[] {
  const entries = readCentralDirectory(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  const text = (name: string): string => {
    const entry = byName.get(name);
    if (!entry) return "";
    try {
      return readEntry(buffer, entry).toString("utf8");
    } catch {
      return "";
    }
  };

  const workbookXml = text("xl/workbook.xml");
  if (!workbookXml) throw new Error("No se encontró la estructura del libro de Excel.");

  const sharedStrings = readSharedStrings(text("xl/sharedStrings.xml"));
  const dateStyles = readDateStyles(text("xl/styles.xml"));
  const sheets = sheetTargets(workbookXml, text("xl/_rels/workbook.xml.rels"));

  const tables: RawTable[] = [];
  for (const sheet of sheets) {
    const xml = text(sheet.path);
    if (!xml) continue;

    const rows = readSheet(xml, sharedStrings, dateStyles);
    const table = buildTable(rows, {
      source,
      sheet: sheet.name,
      format: "excel",
      encoding: "utf-8",
    });
    if (table) tables.push(table);
  }

  return tables;
}

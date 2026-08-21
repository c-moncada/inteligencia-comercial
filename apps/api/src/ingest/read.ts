/** Punto único de entrada: convierte cualquier archivo recibido en tablas. */

import { decodeBuffer } from "./decode.js";
import { readJson } from "./json.js";
import {
  looksLikeHtml,
  looksLikeXml,
  readHtmlTables,
  readSpreadsheetXml,
  readXmlRecords,
} from "./markup.js";
import type { RawTable } from "./table.js";
import { readDelimitedText } from "./tabular.js";
import { isLegacyXlsBuffer, isXlsxBuffer, readXlsx } from "./xlsx.js";

export interface SourceFile {
  name: string;
  buffer: Buffer;
}

export interface ReadResult {
  tables: RawTable[];
  /** Problemas que impidieron leer el archivo completo. */
  errors: string[];
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function isSqlite(buffer: Buffer): boolean {
  return buffer.subarray(0, 15).toString("latin1") === "SQLite format 3";
}

function looksLikeJson(text: string): boolean {
  const head = text.trimStart().slice(0, 1);
  return head === "{" || head === "[";
}

/** Lee un archivo sin importar su formato y devuelve las tablas encontradas. */
export function readSourceFile(file: SourceFile): ReadResult {
  const { name, buffer } = file;
  const errors: string[] = [];

  if (buffer.length === 0) {
    return { tables: [], errors: [`El archivo ${name} está vacío.`] };
  }

  if (isPdf(buffer)) {
    return {
      tables: [],
      errors: [
        `${name} es un PDF. Exporta el reporte a Excel, CSV o texto para poder analizarlo.`,
      ],
    };
  }

  if (isSqlite(buffer)) {
    return {
      tables: [],
      errors: [
        `${name} es una base de datos SQLite. Exporta las tablas de ventas e inventario a CSV o Excel.`,
      ],
    };
  }

  if (isLegacyXlsBuffer(buffer)) {
    return {
      tables: [],
      errors: [
        `${name} usa el formato antiguo de Excel (.xls binario). Ábrelo y guárdalo como .xlsx o CSV.`,
      ],
    };
  }

  if (isXlsxBuffer(buffer)) {
    try {
      const tables = readXlsx(buffer, name);
      if (tables.length === 0) errors.push(`${name} no contiene hojas con datos utilizables.`);
      return { tables, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      return { tables: [], errors: [`No se pudo leer ${name}: ${message}`] };
    }
  }

  const { text, encoding } = decodeBuffer(buffer);
  if (!text.trim()) {
    return { tables: [], errors: [`El archivo ${name} no contiene texto legible.`] };
  }

  if (looksLikeJson(text)) {
    const tables = readJson(text, name);
    if (tables.length > 0) return { tables, errors };
    errors.push(`${name} parece JSON pero no se encontró una lista de registros.`);
  }

  if (looksLikeHtml(text)) {
    const tables = readHtmlTables(text, name, encoding);
    if (tables.length > 0) return { tables, errors };
  }

  if (looksLikeXml(text)) {
    const spreadsheet = readSpreadsheetXml(text, name, encoding);
    if (spreadsheet.length > 0) return { tables: spreadsheet, errors };

    const records = readXmlRecords(text, name, encoding);
    if (records.length > 0) return { tables: records, errors };
  }

  const table = readDelimitedText(text, name, encoding);
  if (!table) {
    return {
      tables: [],
      errors: [...errors, `No se reconoció una tabla dentro de ${name}.`],
    };
  }

  return { tables: [table], errors };
}

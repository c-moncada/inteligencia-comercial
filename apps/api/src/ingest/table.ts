/** Estructura común a la que se reduce cualquier archivo recibido. */

export type TableFormat = "delimitado" | "excel" | "json" | "texto";

export interface RawTable {
  /** Nombre del archivo o de la fuente de datos. */
  source: string;
  /** Hoja de Excel o clave del JSON cuando aplica. */
  sheet?: string;
  format: TableFormat;
  encoding: string;
  /** Delimitador detectado en archivos de texto. */
  delimiter?: string;
  headers: string[];
  rows: string[][];
  /** Línea (base 1) donde se encontró el encabezado. */
  headerLine: number;
  /** Filas de título o membrete descartadas antes del encabezado. */
  skippedLines: number;
}

export function columnValues(table: RawTable, index: number, limit = 400): string[] {
  const values: string[] = [];
  for (const row of table.rows) {
    values.push(row[index] ?? "");
    if (values.length >= limit) break;
  }
  return values;
}

export function delimiterLabel(delimiter: string | undefined): string {
  if (!delimiter) return "no aplica";
  if (delimiter === "\t") return "tabulador";
  if (delimiter === ",") return "coma";
  if (delimiter === ";") return "punto y coma";
  if (delimiter === "|") return "barra vertical";
  if (delimiter === " ") return "espacios";
  return delimiter;
}

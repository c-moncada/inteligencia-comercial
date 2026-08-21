/**
 * Interpretación tolerante de valores: números, fechas y textos que llegan
 * en cualquier formato regional o con adornos del sistema de origen.
 */

const CURRENCY_NOISE = /[^\d.,\-+()eE ]/g;

/**
 * Palabras que pueden acompañar a un número sin dejar de ser un número.
 * Cualquier otra letra significa que el valor es texto: "Aceite 500g" no es
 * la cantidad 500, aunque contenga dígitos.
 */
const CURRENCY_WORDS = new Set([
  "l", "lps", "hnl", "usd", "us", "dls", "eur", "mxn", "gtq", "q", "crc", "nio",
  "pen", "cop", "clp", "ars", "brl", "bs", "sol", "soles", "lempiras", "lempira",
  "dolares", "dolar", "pesos", "peso", "quetzales", "cordobas", "euros",
]);

const SPANISH_MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

export type NumberStyle = "us" | "eu" | "plain";

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** Quita acentos, símbolos y espacios para poder comparar nombres de columnas. */
export function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Igual que slug pero conservando la separación entre palabras. */
export function tokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function stripNoise(raw: string): { body: string; negative: boolean } {
  let text = raw.trim();
  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  if (/-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, "");
  }

  // Solo se aceptan letras si corresponden a una moneda conocida.
  const words = text.match(/\p{L}+/gu) ?? [];
  for (const word of words) {
    const normalized = word
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    if (!CURRENCY_WORDS.has(normalized)) return { body: "", negative: false };
  }

  text = text.replace(CURRENCY_NOISE, "").replace(/\s/g, "");

  // Un código como "001" o "0123" no es una cantidad.
  if (/^0\d/.test(text)) return { body: "", negative: false };

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text.startsWith("+")) text = text.slice(1);

  return { body: text, negative };
}

/**
 * Convierte un texto en número aceptando "1,234.56", "1.234,56", "L 1 234,56",
 * "(450)", "450-", "12%" y notación científica.
 */
export function parseNumber(raw: unknown, style: NumberStyle = "plain"): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  const text = normalizeText(raw);
  if (!text) return null;

  const isPercent = text.includes("%");
  const { body, negative } = stripNoise(text);
  if (!body || !/\d/.test(body)) return null;

  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let cleaned = body;

  if (lastDot >= 0 && lastComma >= 0) {
    // Con ambos separadores presentes, el último es siempre el decimal.
    cleaned =
      lastComma > lastDot
        ? body.replace(/\./g, "").replace(",", ".")
        : body.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = body.length - lastComma - 1;
    const single = body.indexOf(",") === lastComma;
    const looksLikeThousands = single && decimals === 3;

    if (style === "eu") cleaned = body.replace(/,/g, ".");
    else if (!single) cleaned = body.replace(/,/g, "");
    else if (looksLikeThousands && style === "us") cleaned = body.replace(/,/g, "");
    else if (looksLikeThousands) cleaned = body.replace(/,/g, "");
    else cleaned = body.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = body.length - lastDot - 1;
    const single = body.indexOf(".") === lastDot;

    if (!single) cleaned = body.replace(/\./g, "");
    else if (style === "eu" && decimals === 3) cleaned = body.replace(/\./g, "");
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const signed = negative ? -value : value;
  return isPercent ? signed / 100 : signed;
}

/**
 * Observa una columna completa para decidir si usa punto o coma decimal.
 * Evita interpretar "1.500" como 1.5 cuando la columna maneja miles.
 */
export function detectNumberStyle(values: string[]): NumberStyle {
  let us = 0;
  let eu = 0;

  for (const value of values) {
    const text = normalizeText(value);
    if (!text || !/\d/.test(text)) continue;

    const { body } = stripNoise(text);
    if (!body) continue;

    const dot = body.lastIndexOf(".");
    const comma = body.lastIndexOf(",");

    if (dot >= 0 && comma >= 0) {
      if (comma > dot) eu += 1;
      else us += 1;
      continue;
    }

    if (comma >= 0) {
      const decimals = body.length - comma - 1;
      if (decimals === 3 && body.indexOf(",") === comma) us += 0.5;
      else eu += 1;
    }

    if (dot >= 0) {
      const decimals = body.length - dot - 1;
      if (decimals === 3 && body.indexOf(".") === dot) eu += 0.5;
      else us += 1;
    }
  }

  if (eu > us) return "eu";
  if (us > eu) return "us";
  return "plain";
}

export type DateStyle = "iso" | "dmy" | "mdy";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let fullYear = year;
  if (fullYear < 100) fullYear += fullYear >= 70 ? 1900 : 2000;
  if (fullYear < 1900 || fullYear > 2200) return null;

  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${fullYear}-${pad(month)}-${pad(day)}`;
}

/** Convierte el número de serie de Excel (base 1900) en fecha ISO. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20 || serial > 80_000) return null;
  const days = Math.floor(serial);
  const milliseconds = Math.round((days - 25_569) * 86_400_000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseTextualDate(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const dayFirst = normalized.match(
    /^(\d{1,2})\s*[-/ ]?\s*(?:de\s+)?([a-z]{3,10})\.?\s*[-/ ]?\s*(?:de\s+)?(\d{2,4})$/,
  );
  if (dayFirst) {
    const month = SPANISH_MONTHS[dayFirst[2]];
    if (month) return buildDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  const monthFirst = normalized.match(/^([a-z]{3,10})\.?\s*[-/ ]?\s*(\d{1,2}),?\s*(\d{2,4})$/);
  if (monthFirst) {
    const month = SPANISH_MONTHS[monthFirst[1]];
    if (month) return buildDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  return null;
}

export interface DateOptions {
  /**
   * Permite interpretar un número suelto como fecha serial de Excel.
   * Solo se activa en columnas que ya se reconocieron como fechas: de lo
   * contrario cualquier precio o cantidad parecería una fecha.
   */
  allowSerial?: boolean;
}

/** Interpreta una fecha con el estilo indicado y devuelve ISO (YYYY-MM-DD). */
export function parseDate(
  raw: unknown,
  style: DateStyle = "iso",
  options: DateOptions = {},
): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }

  const text = normalizeText(raw);
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ].*)?$/);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const year = Number(parts[3]);
    return style === "mdy"
      ? buildDate(year, first, second) ?? buildDate(year, second, first)
      : buildDate(year, second, first) ?? buildDate(year, first, second);
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return buildDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const textual = parseTextualDate(text);
  if (textual) return textual;

  if (/^\d+([.,]\d+)?$/.test(text)) {
    const value = Number(text.replace(",", "."));
    if (value > 10_000_000_000) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    if (value > 100_000_000) {
      const date = new Date(value * 1000);
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    return options.allowSerial ? excelSerialToIso(value) : null;
  }

  // Último recurso: solo para textos que empiezan con un número y traen año.
  // Así un código como "MED-0003" nunca se interpreta como fecha.
  if (/^\d/.test(text) && /\d{4}/.test(text) && text.length >= 8) {
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Elige el estilo de fecha de una columna. Cuando el día y el mes son ambiguos
 * se busca evidencia: un valor mayor a 12 en la primera o la segunda posición.
 */
export function detectDateStyle(values: string[]): DateStyle {
  let dayFirst = 0;
  let monthFirst = 0;
  let isoCount = 0;
  let separated = 0;

  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;

    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) {
      isoCount += 1;
      continue;
    }

    const parts = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!parts) continue;

    separated += 1;
    if (Number(parts[1]) > 12) dayFirst += 1;
    if (Number(parts[2]) > 12) monthFirst += 1;
  }

  if (isoCount > separated) return "iso";
  if (monthFirst > dayFirst) return "mdy";
  return "dmy";
}

/** Proporción de valores de la muestra que se interpretan como fecha. */
export function dateRatio(values: string[], style: DateStyle = "dmy"): number {
  const usable = values.filter((value) => normalizeText(value).length > 0);
  if (usable.length === 0) return 0;
  return usable.filter((value) => parseDate(value, style) !== null).length / usable.length;
}

/** Proporción de valores de la muestra que se interpretan como número. */
export function numberRatio(values: string[], style: NumberStyle = "plain"): number {
  const usable = values.filter((value) => normalizeText(value).length > 0);
  if (usable.length === 0) return 0;
  return usable.filter((value) => parseNumber(value, style) !== null).length / usable.length;
}

/** Similitud entre dos cadenas (0 a 1) usando distancia de edición. */
export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const rows = left.length + 1;
  const columns = right.length + 1;
  let previous = new Array<number>(columns);
  let current = new Array<number>(columns);

  for (let column = 0; column < columns; column += 1) previous[column] = column;

  for (let row = 1; row < rows; row += 1) {
    current[0] = row;
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  const distance = previous[columns - 1];
  return 1 - distance / Math.max(left.length, right.length);
}

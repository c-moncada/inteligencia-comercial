/**
 * Decodificación tolerante de archivos de texto.
 *
 * Los sistemas administrativos exportan en UTF-8, UTF-8 con BOM, UTF-16 y,
 * con mucha frecuencia en Latinoamérica, en Windows-1252 (acentos y ñ).
 * Aquí se detecta la codificación antes de intentar interpretar el contenido.
 */

export interface DecodedText {
  text: string;
  encoding: string;
}

function decodeWith(buffer: Buffer, encoding: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(buffer);
  } catch {
    return null;
  }
}

function looksLikeUtf16(buffer: Buffer): "utf-16le" | "utf-16be" | null {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length < 4) return null;

  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) continue;
    if (index % 2 === 0) evenZeros += 1;
    else oddZeros += 1;
  }

  const half = sample.length / 2;
  if (oddZeros > half * 0.3 && evenZeros < half * 0.05) return "utf-16le";
  if (evenZeros > half * 0.3 && oddZeros < half * 0.05) return "utf-16be";
  return null;
}

/** Convierte un archivo en texto detectando la codificación más probable. */
export function decodeBuffer(buffer: Buffer): DecodedText {
  if (buffer.length === 0) return { text: "", encoding: "utf-8" };

  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      text: decodeWith(buffer.subarray(3), "utf-8", false) ?? "",
      encoding: "utf-8 (BOM)",
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      text: decodeWith(buffer.subarray(2), "utf-16le", false) ?? "",
      encoding: "utf-16le (BOM)",
    };
  }

  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      text: decodeWith(buffer.subarray(2), "utf-16be", false) ?? "",
      encoding: "utf-16be (BOM)",
    };
  }

  const utf16 = looksLikeUtf16(buffer);
  if (utf16) {
    const text = decodeWith(buffer, utf16, false);
    if (text) return { text, encoding: utf16 };
  }

  const strictUtf8 = decodeWith(buffer, "utf-8", true);
  if (strictUtf8 !== null) return { text: strictUtf8, encoding: "utf-8" };

  const latin = decodeWith(buffer, "windows-1252", false);
  if (latin !== null) return { text: latin, encoding: "windows-1252" };

  return { text: buffer.toString("latin1"), encoding: "latin1" };
}

/** Quita caracteres invisibles que rompen el análisis pero no aportan información. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[​-‏﻿‪-‮]/g, "");
}

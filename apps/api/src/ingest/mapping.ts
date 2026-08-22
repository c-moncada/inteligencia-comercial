/**
 * Reconocimiento automático de columnas.
 *
 * Primero se compara el nombre del encabezado con el diccionario de alias.
 * Cuando el nombre no dice nada (o no hay encabezado), se decide observando el
 * contenido real de la columna: fechas, enteros, dinero, códigos o texto.
 */

import type { CanonicalField, FieldKind } from "./fields.js";
import { ALIAS_INDEX, FIELD_DEFINITIONS, FIELDS_BY_NAME, classifyDocument } from "./fields.js";
import { maxOf } from "../numbers.js";
import type { RawTable } from "./table.js";
import { columnValues } from "./table.js";
import type { DateStyle, NumberStyle } from "./values.js";
import {
  dateRatio,
  detectDateStyle,
  detectNumberStyle,
  normalizeText,
  numberRatio,
  parseNumber,
  similarity,
  slug,
  stripTypePrefix,
  tokens,
} from "./values.js";

export type MappingMethod = "nombre" | "nombre similar" | "contenido" | "derivado";

export interface ColumnMapping {
  field: CanonicalField;
  header: string;
  columnIndex: number;
  confidence: number;
  method: MappingMethod;
  note?: string;
}

export interface ColumnProfile {
  index: number;
  header: string;
  headerSlug: string;
  /** El mismo nombre sin el prefijo de tipo: `c_Codigo` se compara como `codigo`. */
  headerBase: string;
  values: string[];
  filledRatio: number;
  numberRatio: number;
  dateRatio: number;
  integerRatio: number;
  decimalRatio: number;
  uniqueRatio: number;
  wordRatio: number;
  median: number | null;
  maximum: number | null;
  /** Verdadero cuando la columna es un correlativo 1, 2, 3… de la base de datos. */
  rowIndexLike: boolean;
  numberStyle: NumberStyle;
  dateStyle: DateStyle;
}

export type TableRole = "sales" | "inventory" | "catalog" | "both" | "ignored";

export interface TableMapping {
  role: TableRole;
  undated: boolean;
  mappings: ColumnMapping[];
  byField: Map<CanonicalField, ColumnMapping>;
  profiles: ColumnProfile[];
  unmapped: string[];
  notes: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Detecta la columna correlativa que agregan las bases de datos (1, 2, 3…).
 * No es un código de producto ni una existencia: es solo el número de fila.
 */
function isRowIndex(values: number[], filled: number): boolean {
  if (values.length < 4 || values.length !== filled) return false;
  if (!values.every((value) => Number.isInteger(value) && value >= 0)) return false;

  const sorted = [...values].sort((left, right) => left - right);
  if (new Set(sorted).size !== sorted.length) return false;
  return sorted.every((value, index) => value === sorted[0] + index);
}

export function profileColumns(table: RawTable): ColumnProfile[] {
  return table.headers.map((header, index) => {
    const values = columnValues(table, index);
    const filled = values.filter((value) => normalizeText(value) !== "");
    const numberStyle = detectNumberStyle(filled);
    const dateStyle = detectDateStyle(filled);

    const numbers: number[] = [];
    let integers = 0;
    let decimals = 0;
    for (const value of filled) {
      const parsed = parseNumber(value, numberStyle);
      if (parsed === null) continue;
      numbers.push(parsed);
      if (Number.isInteger(parsed)) integers += 1;
      else decimals += 1;
    }

    const unique = new Set(filled.map((value) => value.toLowerCase()));
    const words = filled.filter((value) => /\s/.test(value.trim())).length;

    return {
      index,
      header,
      headerSlug: slug(header),
      headerBase: slug(stripTypePrefix(header)),
      values,
      filledRatio: values.length === 0 ? 0 : filled.length / values.length,
      numberRatio: filled.length === 0 ? 0 : numbers.length / filled.length,
      dateRatio: dateRatio(filled, dateStyle),
      integerRatio: numbers.length === 0 ? 0 : integers / numbers.length,
      decimalRatio: numbers.length === 0 ? 0 : decimals / numbers.length,
      uniqueRatio: filled.length === 0 ? 0 : unique.size / filled.length,
      wordRatio: filled.length === 0 ? 0 : words / filled.length,
      median: median(numbers),
      maximum: numbers.length === 0 ? null : maxOf(numbers),
      rowIndexLike: isRowIndex(numbers, filled.length),
      numberStyle,
      dateStyle,
    } satisfies ColumnProfile;
  });
}

function aliasScore(
  headerSlug: string,
  headerBase: string,
  headerTokens: string[],
  field: CanonicalField,
): number {
  if (!headerSlug) return 0;

  const direct = ALIAS_INDEX.get(headerSlug);
  if (direct === field) return 1;

  // `c_Codigo`, `n_Cantidad`, `d_Fecha`: el prefijo indica el tipo de dato en la
  // base de datos de origen y no dice nada sobre el contenido.
  if (headerBase && headerBase !== headerSlug && ALIAS_INDEX.get(headerBase) === field) {
    return 0.97;
  }

  const definition = FIELDS_BY_NAME.get(field);
  if (!definition) return 0;

  let best = 0;
  for (const alias of [definition.field.replace(/_/g, " "), ...definition.aliases]) {
    const aliasSlug = slug(alias);
    if (!aliasSlug) continue;

    if (aliasSlug === headerSlug) return 1;
    if (headerBase && aliasSlug === headerBase) return 0.97;

    if (aliasSlug.length >= 5 && headerSlug.includes(aliasSlug)) {
      best = Math.max(best, 0.9 - Math.min(0.15, (headerSlug.length - aliasSlug.length) * 0.01));
      continue;
    }

    if (headerSlug.length >= 4 && aliasSlug.includes(headerSlug)) {
      best = Math.max(best, 0.78);
      continue;
    }

    const aliasTokens = tokens(alias);
    if (
      aliasTokens.length > 0 &&
      aliasTokens.every((token) => headerTokens.includes(token)) &&
      aliasTokens.join("").length >= 4
    ) {
      best = Math.max(best, 0.86);
      continue;
    }

    const closeness = similarity(headerSlug, aliasSlug);
    if (closeness >= 0.85) best = Math.max(best, closeness * 0.8);
  }

  return best;
}

function kindFit(profile: ColumnProfile, kind: FieldKind): number {
  if (profile.filledRatio === 0) return 0;

  if (kind === "date") return profile.dateRatio;
  if (kind === "number" || kind === "money") {
    if (profile.dateRatio > 0.8 && profile.numberRatio < 0.5) return 0;
    return profile.numberRatio;
  }
  if (kind === "code") {
    if (profile.rowIndexLike) return 0.2;
    return profile.wordRatio > 0.6 ? 0.5 : 1;
  }

  // Un nombre de producto no puede ser una columna de puros números, aunque el
  // encabezado se parezca ("id_producto" no es el nombre del producto).
  if (profile.rowIndexLike) return 0.1;
  return 1 - profile.numberRatio * 0.8;
}

interface Candidate {
  columnIndex: number;
  field: CanonicalField;
  score: number;
  aliasScore: number;
}

function assignByName(profiles: ColumnProfile[]): Map<CanonicalField, ColumnMapping> {
  const candidates: Candidate[] = [];

  for (const profile of profiles) {
    const headerTokens = tokens(profile.header);
    for (const definition of FIELD_DEFINITIONS) {
      const byName = aliasScore(
        profile.headerSlug,
        profile.headerBase,
        headerTokens,
        definition.field,
      );
      if (byName < 0.6) continue;

      const fit = kindFit(profile, definition.kind);
      // Si el contenido contradice al encabezado, el nombre no basta.
      if (fit < 0.15) continue;

      let score = byName * (0.55 + 0.45 * fit);

      // Un correlativo de base de datos no sirve para cruzar archivos entre sí:
      // se prefiere el código real del producto aunque su nombre coincida menos.
      if (profile.rowIndexLike && (definition.field === "product_id" || definition.field === "current_stock")) {
        score *= 0.3;
      }

      // Entre una llave numérica interna y un código alfanumérico, gana el
      // código: es el que aparece igual en todos los archivos de la empresa.
      if (definition.field === "product_id" && profile.numberRatio > 0.9) {
        score *= 0.85;
      }

      if (score < 0.4) continue;
      candidates.push({ columnIndex: profile.index, field: definition.field, score, aliasScore: byName });
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const byField = new Map<CanonicalField, ColumnMapping>();
  const usedColumns = new Set<number>();

  for (const candidate of candidates) {
    if (byField.has(candidate.field) || usedColumns.has(candidate.columnIndex)) continue;
    const profile = profiles[candidate.columnIndex];
    byField.set(candidate.field, {
      field: candidate.field,
      header: profile.header,
      columnIndex: candidate.columnIndex,
      confidence: Number(candidate.score.toFixed(2)),
      method: candidate.aliasScore >= 0.97 ? "nombre" : "nombre similar",
      note:
        candidate.aliasScore >= 0.97 && candidate.aliasScore < 1
          ? `Se ignoró el prefijo "${profile.header.slice(0, 2)}", que solo marca el tipo de dato en el sistema de origen.`
          : undefined,
    });
    usedColumns.add(candidate.columnIndex);
  }

  return byField;
}

function isGenericHeader(header: string): boolean {
  return /^columna_\d+$/.test(header) || header.trim() === "";
}

function assignByContent(
  profiles: ColumnProfile[],
  byField: Map<CanonicalField, ColumnMapping>,
  notes: string[],
): void {
  const used = new Set(Array.from(byField.values(), (mapping) => mapping.columnIndex));
  const free = profiles.filter((profile) => !used.has(profile.index));

  const take = (field: CanonicalField, profile: ColumnProfile, confidence: number, note: string) => {
    byField.set(field, {
      field,
      header: profile.header,
      columnIndex: profile.index,
      confidence: Number(confidence.toFixed(2)),
      method: "contenido",
      note,
    });
    used.add(profile.index);
    notes.push(`${note} (columna "${profile.header}").`);
  };

  const available = () => free.filter((profile) => !used.has(profile.index));

  if (!byField.has("sale_date")) {
    const candidate = available()
      .filter((profile) => profile.dateRatio >= 0.75 && profile.filledRatio >= 0.4)
      .sort((left, right) => right.dateRatio - left.dateRatio)[0];
    if (candidate) take("sale_date", candidate, 0.62, "Se detectó una columna de fechas por su contenido");
  }

  if (!byField.has("product_name")) {
    const candidate = available()
      .filter(
        (profile) =>
          profile.numberRatio < 0.3 &&
          profile.dateRatio < 0.3 &&
          profile.wordRatio >= 0.25 &&
          profile.filledRatio >= 0.6,
      )
      .sort((left, right) => right.wordRatio - left.wordRatio)[0];
    if (candidate) {
      take("product_name", candidate, 0.6, "Se usó como nombre de producto una columna de texto descriptivo");
    }
  }

  // El código solo se deduce cuando no hay ninguna columna de producto: si hay
  // nombre, el código se genera después a partir del nombre y no se arriesga
  // confundir un número de factura con un código de artículo.
  if (!byField.has("product_id") && !byField.has("product_name")) {
    const candidate = available()
      .filter(
        (profile) =>
          profile.dateRatio < 0.3 &&
          profile.uniqueRatio > 0.05 &&
          profile.wordRatio < 0.4 &&
          profile.filledRatio >= 0.6,
      )
      .sort((left, right) => right.uniqueRatio - left.uniqueRatio)[0];
    if (candidate) {
      const source = isGenericHeader(candidate.header) ? "sin encabezado" : candidate.header;
      take(
        "product_id",
        candidate,
        0.5,
        `Se usó como código de producto la columna de valores cortos (${source})`,
      );
    }
  }

  const numeric = () =>
    available().filter(
      (profile) =>
        profile.numberRatio >= 0.85 && profile.dateRatio < 0.4 && !profile.rowIndexLike,
    );

  const hasDate = byField.has("sale_date");

  if (hasDate && !byField.has("quantity")) {
    const candidate = numeric()
      .filter((profile) => profile.integerRatio >= 0.85 && (profile.median ?? 0) >= 0)
      .sort((left, right) => (left.median ?? 0) - (right.median ?? 0))[0];
    if (candidate) take("quantity", candidate, 0.55, "Se interpretó como cantidad una columna de enteros");
  }

  // La existencia solo se deduce del contenido cuando la columna no tiene un
  // nombre propio: inventar existencias sobre una columna llamada, por ejemplo,
  // "precio_compra" produciría decisiones falsas.
  if (!hasDate && !byField.has("current_stock")) {
    const candidate = numeric()
      .filter((profile) => profile.integerRatio >= 0.8 && isGenericHeader(profile.header))
      .sort((left, right) => (right.median ?? 0) - (left.median ?? 0))[0];
    if (candidate) {
      take("current_stock", candidate, 0.5, "Se interpretó como existencia una columna de enteros");
    }
  }

  const money = numeric()
    .filter((profile) => profile.decimalRatio > 0.15 || (profile.median ?? 0) >= 10)
    .sort((left, right) => (right.median ?? 0) - (left.median ?? 0));

  if (!byField.has("unit_price") && money.length > 0) {
    take("unit_price", money[0], 0.5, "Se interpretó como precio la columna monetaria de mayor valor");
    const remaining = money.filter((profile) => !used.has(profile.index));
    if (!byField.has("unit_cost") && remaining.length > 0) {
      take("unit_cost", remaining[0], 0.48, "Se interpretó como costo la columna monetaria menor");
    }
  }
}

/**
 * Cuando el nombre del producto quedó sobre una columna de códigos y hay otra
 * columna con texto descriptivo sin usar, se reacomodan: el código pasa a ser
 * el identificador y la descripción pasa a ser el nombre.
 */
function refineProductColumns(
  profiles: ColumnProfile[],
  byField: Map<CanonicalField, ColumnMapping>,
  notes: string[],
): void {
  const name = byField.get("product_name");
  if (!name) return;

  const nameProfile = profiles[name.columnIndex];
  const looksLikeCode = nameProfile.wordRatio < 0.2 && nameProfile.uniqueRatio > 0.2;
  if (!looksLikeCode) return;

  const used = new Set(Array.from(byField.values(), (mapping) => mapping.columnIndex));
  const description = profiles
    .filter(
      (profile) =>
        !used.has(profile.index) &&
        profile.wordRatio >= 0.3 &&
        profile.numberRatio < 0.3 &&
        profile.dateRatio < 0.3 &&
        profile.filledRatio >= 0.5,
    )
    .sort((left, right) => right.wordRatio - left.wordRatio)[0];
  if (!description) return;

  if (!byField.has("product_id")) {
    byField.set("product_id", {
      ...name,
      field: "product_id",
      note: "Se tomó como código porque contiene valores cortos sin descripción.",
    });
  }

  byField.set("product_name", {
    field: "product_name",
    header: description.header,
    columnIndex: description.index,
    confidence: 0.6,
    method: "contenido",
    note: "Se tomó como nombre porque contiene el texto descriptivo del producto.",
  });

  notes.push(
    `La columna "${description.header}" se usó como nombre del producto y "${name.header}" como código.`,
  );
}

/**
 * Busca el código del producto entre las columnas sobrantes. Solo se acepta si
 * tiene tantos valores distintos como el nombre del producto: así un número de
 * factura, que cambia en cada fila, nunca se confunde con un código.
 */
function refineProductId(
  profiles: ColumnProfile[],
  byField: Map<CanonicalField, ColumnMapping>,
  notes: string[],
): void {
  if (byField.has("product_id")) return;

  const name = byField.get("product_name");
  if (!name) return;

  const nameProfile = profiles[name.columnIndex];
  const used = new Set(Array.from(byField.values(), (mapping) => mapping.columnIndex));

  const candidate = profiles
    .filter(
      (profile) =>
        !used.has(profile.index) &&
        profile.wordRatio < 0.2 &&
        profile.dateRatio < 0.3 &&
        profile.filledRatio >= 0.8 &&
        Math.abs(profile.uniqueRatio - nameProfile.uniqueRatio) <= 0.12,
    )
    .sort(
      (left, right) =>
        Math.abs(left.uniqueRatio - nameProfile.uniqueRatio) -
        Math.abs(right.uniqueRatio - nameProfile.uniqueRatio),
    )[0];
  if (!candidate) return;

  byField.set("product_id", {
    field: "product_id",
    header: candidate.header,
    columnIndex: candidate.index,
    confidence: 0.55,
    method: "contenido",
    note: "Tiene la misma variedad de valores que el nombre del producto.",
  });
  notes.push(
    `La columna "${candidate.header}" se usó como código de producto porque acompaña al nombre en cada fila.`,
  );
}

function refine(
  profiles: ColumnProfile[],
  byField: Map<CanonicalField, ColumnMapping>,
  notes: string[],
): void {
  const price = byField.get("unit_price");
  const cost = byField.get("unit_cost");
  if (!price || !cost) return;

  const priceMedian = profiles[price.columnIndex].median;
  const costMedian = profiles[cost.columnIndex].median;
  if (priceMedian === null || costMedian === null) return;

  if (costMedian > priceMedian * 1.05) {
    byField.set("unit_price", { ...cost, field: "unit_price", note: "Se corrigió el orden: esta columna tiene los valores mayores." });
    byField.set("unit_cost", { ...price, field: "unit_cost", note: "Se corrigió el orden: esta columna tiene los valores menores." });
    notes.push(
      `Las columnas "${price.header}" y "${cost.header}" se intercambiaron porque el costo resultaba mayor que el precio en la mayoría de filas.`,
    );
  }
}

/**
 * En un archivo de existencias la columna suele llamarse "cantidad", igual que
 * en uno de ventas. Se decide por el resto de la tabla: si trae stock mínimo,
 * lote o vencimiento, y no trae fecha ni documento de venta, esa cantidad es la
 * existencia actual, no lo vendido.
 */
function reinterpretQuantityAsStock(
  byField: Map<CanonicalField, ColumnMapping>,
  notes: string[],
): void {
  if (byField.has("current_stock") || byField.has("sale_date")) return;

  const quantity = byField.get("quantity");
  if (!quantity) return;

  const inventorySignals =
    byField.has("min_stock") || byField.has("expiry_date") || byField.has("lead_time_days");
  const salesSignals =
    byField.has("sale_id") ||
    byField.has("customer_id") ||
    byField.has("line_total") ||
    byField.has("document_type");
  if (!inventorySignals || salesSignals) return;

  byField.set("current_stock", {
    ...quantity,
    field: "current_stock",
    note: "La tabla trae datos de inventario (mínimo, lote o vencimiento) y ninguna fecha de venta.",
  });
  byField.delete("quantity");

  notes.push(
    `La columna "${quantity.header}" se interpretó como existencia actual, no como unidades vendidas, porque la tabla es de inventario.`,
  );
}

/**
 * "Tipo" es una palabra demasiado común: puede ser el tipo de documento o el
 * tipo de producto. Solo se acepta como tipo de documento si los valores de la
 * columna se reconocen de verdad; si no, se suelta y la columna queda sin usar
 * en vez de descartar ventas buenas por una lectura equivocada.
 */
function validateDocumentType(
  profiles: ColumnProfile[],
  byField: Map<CanonicalField, ColumnMapping>,
  notes: string[],
): void {
  const mapping = byField.get("document_type");
  if (!mapping) return;

  const profile = profiles[mapping.columnIndex];
  const filled = profile.values.filter((value) => value.trim() !== "");

  if (filled.length === 0) {
    byField.delete("document_type");
    return;
  }

  const recognized = filled.filter((value) => classifyDocument(value) !== "unknown").length;
  const ratio = recognized / filled.length;

  if (ratio < 0.6) {
    byField.delete("document_type");
    notes.push(
      `La columna "${mapping.header}" no se usó como tipo de documento: sus valores no corresponden a facturas, devoluciones ni movimientos conocidos.`,
    );
    return;
  }

  const kinds = new Set(filled.map((value) => classifyDocument(value)));
  const special = [...kinds].filter((kind) => kind === "return" || kind === "entry" || kind === "not_a_sale");

  if (special.length > 0) {
    notes.push(
      `La columna "${mapping.header}" indica el tipo de cada documento: las devoluciones restan de la venta y los documentos que no son ventas se descartan.`,
    );
  }
}

function detectRole(byField: Map<CanonicalField, ColumnMapping>): {
  role: TableRole;
  undated: boolean;
} {
  const hasProduct = byField.has("product_id") || byField.has("product_name");
  const hasDate = byField.has("sale_date");
  const hasQuantity = byField.has("quantity");
  const hasValue = byField.has("unit_price") || byField.has("line_total");
  const hasStock = byField.has("current_stock");

  if (!hasProduct) return { role: "ignored", undated: false };

  const salesReady = hasDate && (hasQuantity || byField.has("line_total"));
  // Un archivo sin fechas pero con unidades y precio se trata como el total
  // vendido durante el período: es la exportación resumida más común.
  const aggregatedSales = !hasDate && hasQuantity && hasValue;

  if (salesReady && hasStock) return { role: "both", undated: false };
  if (salesReady) return { role: "sales", undated: false };
  if (aggregatedSales && hasStock) return { role: "both", undated: true };
  if (hasStock) return { role: "inventory", undated: false };
  if (aggregatedSales) return { role: "sales", undated: true };

  // Catálogo de productos: no tiene movimientos ni existencias, pero aporta
  // nombre, categoría, costo y precio para completar los otros archivos.
  if (!hasQuantity && (byField.has("unit_cost") || byField.has("unit_price"))) {
    return { role: "catalog", undated: false };
  }

  return { role: "ignored", undated: false };
}

/** Analiza una tabla y devuelve qué columna corresponde a cada campo canónico. */
export function mapTable(table: RawTable): TableMapping {
  const profiles = profileColumns(table);
  const notes: string[] = [];

  const byField = assignByName(profiles);
  refineProductColumns(profiles, byField, notes);
  assignByContent(profiles, byField, notes);
  refineProductId(profiles, byField, notes);
  refine(profiles, byField, notes);
  validateDocumentType(profiles, byField, notes);
  reinterpretQuantityAsStock(byField, notes);

  const { role, undated } = detectRole(byField);
  const used = new Set(Array.from(byField.values(), (mapping) => mapping.columnIndex));

  if (undated) {
    const quantityColumn = byField.get("quantity")?.header ?? "cantidad";
    notes.push(
      `La tabla no trae fechas: la columna "${quantityColumn}" se interpretó como las unidades vendidas durante el período completo.`,
    );
  }

  return {
    role,
    undated,
    mappings: Array.from(byField.values()).sort((left, right) => left.columnIndex - right.columnIndex),
    byField,
    profiles,
    unmapped: profiles.filter((profile) => !used.has(profile.index)).map((profile) => profile.header),
    notes,
  };
}

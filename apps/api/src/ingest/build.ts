/**
 * Construcción de filas canónicas a partir de una tabla ya mapeada.
 *
 * El criterio es no perder información por detalles de formato: se completa lo
 * que se puede deducir, se descartan solo las filas imposibles y cada decisión
 * queda registrada para mostrarla al usuario.
 */

import type { InventoryRow, SaleRow } from "../types.js";
import type { CanonicalField } from "./fields.js";
import { classifyDocument } from "./fields.js";
import type { ColumnMapping, TableMapping } from "./mapping.js";
import type { RawTable } from "./table.js";
import { normalizeText, parseDate, parseNumber, slug } from "./values.js";

const FOOTER_PATTERN = /^(total(es)?|sub\s?total|gran\s?total|suma|totales generales)\b/i;

export interface BuildIssue {
  level: "info" | "warning";
  message: string;
  count: number;
}

export interface BuildResult<T> {
  rows: T[];
  rowsRead: number;
  rowsUsed: number;
  rowsDiscarded: number;
  issues: BuildIssue[];
  notes: string[];
}

class IssueLog {
  private readonly entries = new Map<string, BuildIssue>();

  add(level: "info" | "warning", message: string): void {
    const existing = this.entries.get(message);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.entries.set(message, { level, message, count: 1 });
  }

  list(): BuildIssue[] {
    return Array.from(this.entries.values()).sort((left, right) => right.count - left.count);
  }
}

function cellReader(table: RawTable, mapping: TableMapping) {
  return (row: string[], field: CanonicalField): string => {
    const column = mapping.byField.get(field);
    if (!column) return "";
    return normalizeText(row[column.columnIndex]);
  };
}

function numberReader(mapping: TableMapping) {
  return (raw: string, column: ColumnMapping | undefined): number | null => {
    if (!raw || !column) return null;
    return parseNumber(raw, mapping.profiles[column.columnIndex].numberStyle);
  };
}

function productIdentity(
  identifier: string,
  name: string,
): { productId: string; productName: string } | null {
  const cleanId = identifier.trim();
  const cleanName = name.trim();

  if (!cleanId && !cleanName) return null;
  if (FOOTER_PATTERN.test(cleanName) || FOOTER_PATTERN.test(cleanId)) return null;

  const productId = cleanId || `AUTO-${slug(cleanName).slice(0, 40) || "producto"}`;
  return { productId, productName: cleanName || cleanId };
}

/** Convierte una tabla de ventas en filas canónicas. */
export function buildSalesRows(
  table: RawTable,
  mapping: TableMapping,
  options: { fallbackDate: string },
): BuildResult<SaleRow> {
  const cell = cellReader(table, mapping);
  const readNumber = numberReader(mapping);
  const issues = new IssueLog();
  const notes: string[] = [];

  const dateColumn = mapping.byField.get("sale_date");
  const dateStyle = dateColumn ? mapping.profiles[dateColumn.columnIndex].dateStyle : "iso";
  const documentColumn = mapping.byField.get("document_type");
  const rows: SaleRow[] = [];
  let discarded = 0;

  table.rows.forEach((row, index) => {
    const identity = productIdentity(cell(row, "product_id"), cell(row, "product_name"));
    if (!identity) {
      discarded += 1;
      issues.add("info", "Filas sin producto identificable (totales, separadores o vacías).");
      return;
    }

    // Una nota de crédito suma venta si se lee como factura, y un presupuesto
    // inventa una venta que nunca ocurrió. El tipo de documento lo resuelve.
    let isReturn = false;
    if (documentColumn) {
      const kind = classifyDocument(cell(row, "document_type"));

      if (kind === "not_a_sale") {
        discarded += 1;
        issues.add(
          "info",
          "Filas descartadas por no ser ventas: presupuestos, cotizaciones, pedidos o documentos anulados.",
        );
        return;
      }

      if (kind === "entry") {
        discarded += 1;
        issues.add(
          "info",
          "Filas descartadas por ser compras o entradas de almacén, no salidas por venta.",
        );
        return;
      }

      isReturn = kind === "return";
    }

    let saleDate = options.fallbackDate;
    if (dateColumn) {
      const parsed = parseDate(cell(row, "sale_date"), dateStyle, { allowSerial: true });
      if (!parsed) {
        discarded += 1;
        issues.add("warning", "Filas descartadas porque la fecha no pudo interpretarse.");
        return;
      }
      saleDate = parsed;
    }

    const lineTotal = readNumber(cell(row, "line_total"), mapping.byField.get("line_total"));
    const lineCost = readNumber(cell(row, "line_cost_total"), mapping.byField.get("line_cost_total"));
    let quantity = readNumber(cell(row, "quantity"), mapping.byField.get("quantity"));
    let unitPrice = readNumber(cell(row, "unit_price"), mapping.byField.get("unit_price"));
    let unitCost = readNumber(cell(row, "unit_cost"), mapping.byField.get("unit_cost"));
    const marginPercent = readNumber(
      cell(row, "margin_percent"),
      mapping.byField.get("margin_percent"),
    );

    if (quantity === null && lineTotal !== null && unitPrice !== null && unitPrice !== 0) {
      quantity = lineTotal / unitPrice;
      issues.add("info", "Cantidad calculada dividiendo el importe entre el precio unitario.");
    }

    if (quantity === null) {
      discarded += 1;
      issues.add("warning", "Filas descartadas porque no se encontró la cantidad vendida.");
      return;
    }

    if (unitPrice === null && lineTotal !== null && quantity !== 0) {
      unitPrice = lineTotal / quantity;
      issues.add("info", "Precio unitario calculado a partir del importe de la línea.");
    }

    if (unitPrice === null) {
      // Un movimiento de almacén trae cantidad y costo, pero no precio de venta.
      // Se deja pendiente para tomarlo del inventario o del catálogo; si no
      // aparece en ningún archivo, la fila se descarta después y se informa.
      unitPrice = Number.NaN;
      issues.add(
        "info",
        "Filas sin precio de venta: el precio se buscó en el inventario o el catálogo.",
      );
    }

    if (unitCost === null && lineCost !== null && quantity !== 0) {
      unitCost = lineCost / quantity;
      issues.add("info", "Costo unitario calculado a partir del costo total de la línea.");
    }

    if (unitCost === null && marginPercent !== null) {
      const ratio = Math.abs(marginPercent) > 1 ? marginPercent / 100 : marginPercent;
      if (ratio > -1 && ratio < 1) {
        unitCost = unitPrice * (1 - ratio);
        issues.add("info", "Costo unitario reconstruido con el margen informado.");
      }
    }

    // Una devolución debe quedar como cantidad negativa a precio positivo: así
    // resta de la venta sin ensuciar el precio unitario del producto.
    if (unitPrice < 0) {
      unitPrice = -unitPrice;
      quantity = -quantity;
    }
    if (unitCost !== null && unitCost < 0) unitCost = -unitCost;

    // Si el archivo ya trae la devolución en negativo, no se vuelve a invertir.
    if (isReturn && quantity > 0) {
      quantity = -quantity;
      issues.add("info", "Devoluciones y notas de crédito restadas de las unidades vendidas.");
    }

    const saleId = cell(row, "sale_id") || `${table.sheet ?? table.source}-${index + 1}`;
    const customerId = cell(row, "customer_id");

    rows.push({
      sale_id: saleId,
      sale_date: saleDate,
      product_id: identity.productId,
      product_name: identity.productName,
      quantity,
      unit_price: unitPrice,
      unit_cost: unitCost ?? Number.NaN,
      customer_id: customerId || undefined,
    });
  });

  if (!dateColumn) {
    notes.push(
      "La tabla no traía fechas: las ventas se tratan como un total del período asumido.",
    );
  }

  return {
    rows,
    rowsRead: table.rows.length,
    rowsUsed: rows.length,
    rowsDiscarded: discarded,
    issues: issues.list(),
    notes,
  };
}

/** Datos de referencia de un producto, sin movimientos ni existencias. */
export interface CatalogRow {
  product_id: string;
  product_name: string;
  unit_cost: number | null;
  unit_price: number | null;
  category?: string;
}

/**
 * Convierte un catálogo de productos en filas de referencia. Sirve para
 * completar el costo, el precio y el nombre cuando las ventas o el inventario
 * no los traen, que es lo normal cuando el sistema exporta tablas separadas.
 */
export function buildCatalogRows(
  table: RawTable,
  mapping: TableMapping,
): BuildResult<CatalogRow> {
  const cell = cellReader(table, mapping);
  const readNumber = numberReader(mapping);
  const issues = new IssueLog();

  const rows: CatalogRow[] = [];
  let discarded = 0;

  table.rows.forEach((row) => {
    const identity = productIdentity(cell(row, "product_id"), cell(row, "product_name"));
    if (!identity) {
      discarded += 1;
      issues.add("info", "Filas sin producto identificable (totales, separadores o vacías).");
      return;
    }

    rows.push({
      product_id: identity.productId,
      product_name: identity.productName,
      unit_cost: readNumber(cell(row, "unit_cost"), mapping.byField.get("unit_cost")),
      unit_price: readNumber(cell(row, "unit_price"), mapping.byField.get("unit_price")),
      category: cell(row, "category") || undefined,
    });
  });

  return {
    rows,
    rowsRead: table.rows.length,
    rowsUsed: rows.length,
    rowsDiscarded: discarded,
    issues: issues.list(),
    notes: [
      "La tabla se usó como catálogo de productos: aporta nombre, costo y precio, no movimientos.",
    ],
  };
}

/** Convierte una tabla de inventario en filas canónicas. */
export function buildInventoryRows(
  table: RawTable,
  mapping: TableMapping,
  options: { defaultLeadTimeDays: number },
): BuildResult<InventoryRow> {
  const cell = cellReader(table, mapping);
  const readNumber = numberReader(mapping);
  const issues = new IssueLog();
  const notes: string[] = [];

  const rows: InventoryRow[] = [];
  let discarded = 0;
  let missingLeadTime = 0;

  table.rows.forEach((row) => {
    const identity = productIdentity(cell(row, "product_id"), cell(row, "product_name"));
    if (!identity) {
      discarded += 1;
      issues.add("info", "Filas sin producto identificable (totales, separadores o vacías).");
      return;
    }

    const stock = readNumber(cell(row, "current_stock"), mapping.byField.get("current_stock"));
    if (stock === null) {
      discarded += 1;
      issues.add("warning", "Filas descartadas porque no se encontró la existencia.");
      return;
    }

    const unitCost = readNumber(cell(row, "unit_cost"), mapping.byField.get("unit_cost"));
    const unitPrice = readNumber(cell(row, "unit_price"), mapping.byField.get("unit_price"));
    const leadTime = readNumber(cell(row, "lead_time_days"), mapping.byField.get("lead_time_days"));
    if (leadTime === null) missingLeadTime += 1;

    rows.push({
      product_id: identity.productId,
      product_name: identity.productName,
      current_stock: stock,
      unit_cost: unitCost ?? Number.NaN,
      lead_time_days: leadTime ?? options.defaultLeadTimeDays,
      unit_price: unitPrice ?? undefined,
    });
  });

  if (missingLeadTime > 0) {
    notes.push(
      `${missingLeadTime === 1 ? "1 fila no traía" : `${missingLeadTime} filas no traían`} días de reposición: se asumieron ${options.defaultLeadTimeDays} días.`,
    );
  }

  return {
    rows,
    rowsRead: table.rows.length,
    rowsUsed: rows.length,
    rowsDiscarded: discarded,
    issues: issues.list(),
    notes,
  };
}

/**
 * Orquestación de la ingesta: recibe archivos de cualquier tipo y devuelve el
 * conjunto canónico de ventas e inventario, junto con el detalle de cómo se
 * interpretó cada columna.
 */

import type {
  IngestColumnMapping,
  IngestReport,
  IngestTableReport,
  InventoryRow,
  SaleRow,
} from "../types.js";
import type { CatalogRow } from "./build.js";
import { buildCatalogRows, buildInventoryRows, buildSalesRows } from "./build.js";
import { fieldLabel } from "./fields.js";
import type { TableMapping } from "./mapping.js";
import { mapTable } from "./mapping.js";
import type { SourceFile } from "./read.js";
import { readSourceFile } from "./read.js";
import { delimiterLabel } from "./table.js";
import type { RawTable } from "./table.js";

export type { SourceFile } from "./read.js";

const DEFAULT_LEAD_TIME_DAYS = 7;
const DEFAULT_ASSUMED_PERIOD_DAYS = 30;

export interface IngestOptions {
  defaultLeadTimeDays?: number;
  assumedPeriodDays?: number;
  today?: string;
}

export interface IngestOutcome {
  sales: SaleRow[];
  inventory: InventoryRow[];
  report: IngestReport;
  /** Productos cuyo costo no venía en ningún archivo. */
  productsWithoutCost: string[];
  /** Productos con ventas pero sin registro de existencias. */
  productsWithoutInventory: string[];
  datesDetected: boolean;
  /** Días de período asumidos cuando los datos no traen fechas. */
  assumedPeriodDays: number | null;
}

export class IngestError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = "IngestError";
  }
}

function toMappingReport(mapping: TableMapping): IngestColumnMapping[] {
  return mapping.mappings.map((item) => ({
    field: item.field,
    fieldLabel: fieldLabel(item.field),
    column: item.header,
    confidence: item.confidence,
    method: item.method,
    note: item.note,
  }));
}

function tableReport(
  table: RawTable,
  mapping: TableMapping,
  counts: { rowsRead: number; rowsUsed: number; rowsDiscarded: number },
  issues: { level: "info" | "warning"; message: string; count: number }[],
  notes: string[],
): IngestTableReport {
  return {
    source: table.source,
    sheet: table.sheet,
    role: mapping.role,
    format: table.format,
    encoding: table.encoding,
    delimiter: delimiterLabel(table.delimiter),
    headerLine: table.headerLine,
    columns: table.headers,
    mappings: toMappingReport(mapping),
    unmappedColumns: mapping.unmapped,
    rowsRead: counts.rowsRead,
    rowsUsed: counts.rowsUsed,
    rowsDiscarded: counts.rowsDiscarded,
    issues: issues.map((issue) => ({
      level: issue.level,
      message: issue.message,
      count: issue.count,
    })),
    notes: [...mapping.notes, ...notes],
  };
}

class ProductKeys {
  private readonly canonical = new Map<string, string>();
  private readonly names = new Map<string, Map<string, number>>();

  resolve(productId: string, productName: string): string {
    const key = productId.trim().replace(/\s+/g, " ").toUpperCase();
    const existing = this.canonical.get(key);
    const canonicalId = existing ?? productId.trim();
    if (!existing) this.canonical.set(key, canonicalId);

    const name = productName.trim();
    if (name) {
      const counter = this.names.get(canonicalId) ?? new Map<string, number>();
      counter.set(name, (counter.get(name) ?? 0) + 1);
      this.names.set(canonicalId, counter);
    }

    return canonicalId;
  }

  /** Nombre más frecuente observado para el producto. */
  bestName(productId: string): string {
    const counter = this.names.get(productId);
    if (!counter) return productId;

    let best = productId;
    let bestCount = 0;
    for (const [name, count] of counter) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    return best;
  }
}

function mergeInventory(rows: InventoryRow[], keys: ProductKeys): InventoryRow[] {
  const grouped = new Map<string, InventoryRow[]>();

  for (const row of rows) {
    const productId = keys.resolve(row.product_id, row.product_name);
    const current = grouped.get(productId) ?? [];
    current.push({ ...row, product_id: productId });
    grouped.set(productId, current);
  }

  const merged: InventoryRow[] = [];
  for (const [productId, group] of grouped) {
    const stock = group.reduce((sum, row) => sum + row.current_stock, 0);
    const costed = group.filter((row) => Number.isFinite(row.unit_cost) && row.unit_cost > 0);
    const weight = costed.reduce((sum, row) => sum + Math.max(row.current_stock, 0), 0);
    const unitCost =
      weight > 0
        ? costed.reduce((sum, row) => sum + row.unit_cost * Math.max(row.current_stock, 0), 0) / weight
        : costed.length > 0
          ? costed.reduce((sum, row) => sum + row.unit_cost, 0) / costed.length
          : Number.NaN;

    const prices = group
      .map((row) => row.unit_price)
      .filter((price): price is number => typeof price === "number" && Number.isFinite(price));

    merged.push({
      product_id: productId,
      product_name: keys.bestName(productId),
      current_stock: stock,
      unit_cost: unitCost,
      lead_time_days: Math.max(...group.map((row) => row.lead_time_days)),
      unit_price: prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : undefined,
    });
  }

  return merged;
}

function averageCostFromSales(sales: SaleRow[]): Map<string, number> {
  const totals = new Map<string, { cost: number; units: number }>();

  for (const sale of sales) {
    if (!Number.isFinite(sale.unit_cost)) continue;
    const units = Math.max(sale.quantity, 0);
    if (units <= 0) continue;
    const current = totals.get(sale.product_id) ?? { cost: 0, units: 0 };
    current.cost += sale.unit_cost * units;
    current.units += units;
    totals.set(sale.product_id, current);
  }

  const averages = new Map<string, number>();
  for (const [productId, value] of totals) {
    if (value.units > 0) averages.set(productId, value.cost / value.units);
  }
  return averages;
}

function averagePriceFromSales(sales: SaleRow[]): Map<string, number> {
  const totals = new Map<string, { revenue: number; units: number }>();

  for (const sale of sales) {
    const units = Math.max(sale.quantity, 0);
    if (units <= 0) continue;
    const current = totals.get(sale.product_id) ?? { revenue: 0, units: 0 };
    current.revenue += sale.unit_price * units;
    current.units += units;
    totals.set(sale.product_id, current);
  }

  const averages = new Map<string, number>();
  for (const [productId, value] of totals) {
    if (value.units > 0) averages.set(productId, value.revenue / value.units);
  }
  return averages;
}

/** Lee todos los archivos recibidos y arma el conjunto de datos del análisis. */
export function ingestFiles(files: SourceFile[], options: IngestOptions = {}): IngestOutcome {
  const defaultLeadTime = options.defaultLeadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const assumedPeriod = options.assumedPeriodDays ?? DEFAULT_ASSUMED_PERIOD_DAYS;
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  if (files.length === 0) {
    throw new IngestError("No se recibió ningún archivo para analizar.");
  }

  const fileSummaries: IngestReport["files"] = [];
  const tableReports: IngestTableReport[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  const salesRows: SaleRow[] = [];
  const inventoryRows: InventoryRow[] = [];
  const catalogRows: CatalogRow[] = [];
  const keys = new ProductKeys();

  let datesDetected = false;

  for (const file of files) {
    const { tables, errors: readErrors } = readSourceFile(file);
    errors.push(...readErrors);

    fileSummaries.push({
      name: file.name,
      sizeBytes: file.buffer.length,
      tables: tables.length,
      format: tables[0]?.format ?? "desconocido",
    });

    for (const table of tables) {
      const mapping = mapTable(table);

      if (mapping.role === "ignored") {
        tableReports.push(
          tableReport(
            table,
            mapping,
            { rowsRead: table.rows.length, rowsUsed: 0, rowsDiscarded: table.rows.length },
            [],
            [
              "No se reconocieron columnas suficientes para usar esta tabla (se necesita producto y, al menos, ventas o existencias).",
            ],
          ),
        );
        continue;
      }

      const localNotes: string[] = [];
      const localIssues: { level: "info" | "warning"; message: string; count: number }[] = [];
      let rowsUsed = 0;
      let rowsDiscarded = 0;

      if (mapping.role === "sales" || mapping.role === "both") {
        const built = buildSalesRows(table, mapping, { fallbackDate: today });
        for (const row of built.rows) {
          const productId = keys.resolve(row.product_id, row.product_name);
          salesRows.push({ ...row, product_id: productId });
        }
        rowsUsed = Math.max(rowsUsed, built.rowsUsed);
        rowsDiscarded = Math.max(rowsDiscarded, built.rowsDiscarded);
        localIssues.push(...built.issues);
        localNotes.push(...built.notes);
        if (!mapping.undated) datesDetected = true;
      }

      if (mapping.role === "catalog") {
        const built = buildCatalogRows(table, mapping);
        catalogRows.push(...built.rows);
        rowsUsed = built.rowsUsed;
        rowsDiscarded = built.rowsDiscarded;
        localIssues.push(...built.issues);
        localNotes.push(...built.notes);
      }

      if (mapping.role === "inventory" || mapping.role === "both") {
        const built = buildInventoryRows(table, mapping, {
          defaultLeadTimeDays: defaultLeadTime,
        });
        inventoryRows.push(...built.rows);
        if (mapping.role === "inventory") {
          rowsUsed = Math.max(rowsUsed, built.rowsUsed);
          rowsDiscarded = Math.max(rowsDiscarded, built.rowsDiscarded);
        }
        localIssues.push(...built.issues);
        localNotes.push(...built.notes);
      }

      tableReports.push(
        tableReport(
          table,
          mapping,
          { rowsRead: table.rows.length, rowsUsed, rowsDiscarded },
          localIssues,
          localNotes,
        ),
      );
    }
  }

  if (salesRows.length === 0) {
    const detail = tableReports.map((report) => {
      const roleText =
        report.role === "inventory"
          ? "se reconoció como inventario"
          : report.role === "ignored"
            ? "no se reconoció"
            : "se reconoció como ventas pero no quedaron filas válidas";
      return `${report.source}${report.sheet ? ` · ${report.sheet}` : ""}: ${roleText}. Columnas detectadas: ${
        report.columns.slice(0, 10).join(", ") || "ninguna"
      }`;
    });

    const onlyInventory =
      tableReports.length > 0 && tableReports.every((report) => report.role === "inventory");

    throw new IngestError(
      onlyInventory
        ? "Solo se reconoció inventario. Agrega el archivo de ventas (o una columna de unidades vendidas) para poder calcular decisiones."
        : "No se encontraron ventas utilizables. Se necesita al menos producto y cantidad vendida (o importe) por línea.",
      [...detail, ...errors],
    );
  }

  const inventoryProvided = inventoryRows.length > 0;
  const inventory = mergeInventory(inventoryRows, keys);
  const inventoryById = new Map(inventory.map((row) => [row.product_id, row]));

  // El catálogo se cruza por el mismo código normalizado que ventas e inventario.
  const catalogById = new Map<string, CatalogRow>();
  for (const row of catalogRows) {
    const productId = keys.resolve(row.product_id, row.product_name);
    catalogById.set(productId, { ...row, product_id: productId });
  }

  const salesCost = averageCostFromSales(salesRows);
  const salesPrice = averagePriceFromSales(salesRows);

  // Los productos que se venden pero no aparecen en el inventario se registran
  // con existencia cero para que el riesgo de agotamiento quede visible.
  const productsWithoutInventory: string[] = [];
  const soldProducts = new Map<string, string>();
  for (const sale of salesRows) soldProducts.set(sale.product_id, sale.product_name);

  for (const [productId, productName] of soldProducts) {
    if (inventoryById.has(productId)) continue;
    productsWithoutInventory.push(productId);
    const row: InventoryRow = {
      product_id: productId,
      product_name: keys.bestName(productId) || productName,
      current_stock: 0,
      unit_cost: salesCost.get(productId) ?? Number.NaN,
      lead_time_days: defaultLeadTime,
    };
    inventory.push(row);
    inventoryById.set(productId, row);
  }

  // Resolución del costo: inventario, catálogo, ventas y, como último recurso,
  // el precio (margen cero) para no inventar ganancias que no se pueden comprobar.
  const productsWithoutCost: string[] = [];
  for (const row of inventory) {
    const catalog = catalogById.get(row.product_id);
    if (catalog) {
      if (row.unit_price === undefined && catalog.unit_price !== null) {
        row.unit_price = catalog.unit_price;
      }
      if (catalog.category && row.category === undefined) row.category = catalog.category;
    }

    if (Number.isFinite(row.unit_cost) && row.unit_cost > 0) continue;

    if (catalog?.unit_cost !== undefined && catalog?.unit_cost !== null && catalog.unit_cost > 0) {
      row.unit_cost = catalog.unit_cost;
      continue;
    }

    const fromSales = salesCost.get(row.product_id);
    if (fromSales !== undefined && fromSales > 0) {
      row.unit_cost = fromSales;
      continue;
    }

    const price = row.unit_price ?? salesPrice.get(row.product_id);
    row.unit_cost = price ?? 0;
    productsWithoutCost.push(row.product_id);
  }

  const costByProduct = new Map(inventory.map((row) => [row.product_id, row.unit_cost]));
  for (const sale of salesRows) {
    if (Number.isFinite(sale.unit_cost) && sale.unit_cost >= 0) continue;
    sale.unit_cost = costByProduct.get(sale.product_id) ?? sale.unit_price;
  }

  for (const row of inventory) row.product_name = keys.bestName(row.product_id);
  for (const sale of salesRows) sale.product_name = keys.bestName(sale.product_id);

  if (!inventoryProvided) {
    warnings.push(
      "No se reconoció ningún archivo de inventario: se asume existencia cero. Las compras sugeridas son un máximo teórico hasta cargar las existencias reales.",
    );
  }

  if (productsWithoutInventory.length > 0 && inventoryProvided) {
    warnings.push(
      `${productsWithoutInventory.length} productos con ventas no aparecen en el inventario. Se registraron con existencia cero.`,
    );
  }

  if (productsWithoutCost.length > 0) {
    warnings.push(
      `${productsWithoutCost.length} productos no traían costo: se asume margen cero para no reportar ganancias inexistentes.`,
    );
  }

  if (!datesDetected) {
    warnings.push(
      `Los datos no traen fechas de venta: se analiza el archivo como un período de ${assumedPeriod} días y no se entrena el modelo de demanda.`,
    );
  }

  if (catalogById.size > 0) {
    const used = Array.from(catalogById.keys()).filter((productId) =>
      inventoryById.has(productId),
    ).length;
    notes.push(
      `Se usó un catálogo de ${catalogById.size} productos para completar nombre, costo y precio; cruzó con ${used} productos analizados.`,
    );

    if (used === 0) {
      warnings.push(
        "El catálogo de productos no cruzó con ningún código de las ventas ni del inventario. Revisa que ambos archivos usen el mismo código de producto.",
      );
    }
  }

  const inventoryOnly = inventory.filter((row) => !soldProducts.has(row.product_id));
  if (inventoryOnly.length > 0) {
    notes.push(
      `${inventoryOnly.length} productos del inventario no registraron ventas en el período. Se revisan como inventario sin rotación.`,
    );
  }

  const costCoverage =
    inventory.length === 0
      ? 0
      : (inventory.length - productsWithoutCost.length) / inventory.length;

  const report: IngestReport = {
    files: fileSummaries,
    tables: tableReports,
    salesRows: salesRows.length,
    inventoryRows: inventory.length,
    productsWithSales: soldProducts.size,
    productsWithInventory: inventory.length - productsWithoutInventory.length,
    productsMatched: Array.from(soldProducts.keys()).filter((productId) =>
      inventoryById.has(productId),
    ).length,
    catalogProducts: catalogById.size,
    inventoryProvided,
    costCoverage: Number(costCoverage.toFixed(3)),
    datesDetected,
    assumedPeriodDays: datesDetected ? null : assumedPeriod,
    warnings,
    notes,
    errors,
  };

  return {
    sales: salesRows,
    inventory,
    report,
    productsWithoutCost,
    productsWithoutInventory,
    datesDetected,
    assumedPeriodDays: datesDetected ? null : assumedPeriod,
  };
}

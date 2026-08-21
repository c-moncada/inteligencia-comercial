import type { InventoryRow, SaleRow } from "./types.js";

const start = new Date("2025-12-01T00:00:00Z");
const end = new Date("2026-07-31T00:00:00Z");

const products = {
  "P-001": { productName: "Producto rentable", unitPrice: 180, unitCost: 95 },
  "P-002": { productName: "Producto sobreabastecido", unitPrice: 250, unitCost: 170 },
  "P-003": { productName: "Producto con margen bajo", unitPrice: 105, unitCost: 100 },
  "P-004": { productName: "Producto por agotarse", unitPrice: 160, unitCost: 105 },
  "P-006": { productName: "Producto estacional detenido", unitPrice: 210, unitCost: 140 },
} as const;

type ProductId = keyof typeof products;

function quantity(productId: ProductId, current: Date, dayIndex: number): number {
  const weekday = (current.getUTCDay() + 6) % 7;
  const day = current.getUTCDate();

  if (productId === "P-001") {
    const trend = Math.floor(dayIndex / 70);
    const weekly = [4, 5, 5, 6, 8, 3, 2][weekday];
    const promotion = day === 5 || day === 20 ? 7 : 0;
    return weekly + trend + promotion;
  }

  if (productId === "P-002") {
    return day === 1 || day === 15 ? 2 : dayIndex % 13 === 0 ? 1 : 0;
  }

  if (productId === "P-006") {
    // Temporada que terminó: deja de venderse a los tres meses.
    if (dayIndex > 92) return 0;
    return [3, 4, 4, 5, 6, 2, 1][weekday];
  }

  if (productId === "P-003") {
    const weekly = [8, 8, 7, 7, 9, 5, 4][weekday];
    return weekly + (day === 10 || day === 25 ? 2 : 0);
  }

  const trend = Math.floor(dayIndex / 35);
  const weekly = [5, 6, 7, 8, 10, 8, 6][weekday];
  const campaign = day >= 12 && day <= 14 ? 10 : 0;
  return weekly + trend + campaign;
}

function createDemoSales(): SaleRow[] {
  const rows: SaleRow[] = [];
  let saleNumber = 1;

  for (
    let current = new Date(start);
    current <= end;
    current = new Date(current.getTime() + 86_400_000)
  ) {
    const dayIndex = Math.floor((current.getTime() - start.getTime()) / 86_400_000);

    for (const productId of Object.keys(products) as ProductId[]) {
      const units = quantity(productId, current, dayIndex);
      if (units <= 0) continue;

      const product = products[productId];
      rows.push({
        sale_id: `V-${String(saleNumber).padStart(5, "0")}`,
        sale_date: current.toISOString().slice(0, 10),
        product_id: productId,
        product_name: product.productName,
        quantity: units,
        unit_price: product.unitPrice,
        unit_cost: product.unitCost,
        customer_id: `C-${String((saleNumber % 18) + 1).padStart(2, "0")}`,
      });
      saleNumber += 1;
    }
  }

  return rows;
}

export const demoSales = createDemoSales();

export const demoInventory: InventoryRow[] = [
  { product_id: "P-001", product_name: "Producto rentable", current_stock: 80, unit_cost: 95, lead_time_days: 12 },
  { product_id: "P-002", product_name: "Producto sobreabastecido", current_stock: 220, unit_cost: 170, lead_time_days: 8 },
  { product_id: "P-003", product_name: "Producto con margen bajo", current_stock: 300, unit_cost: 100, lead_time_days: 10 },
  { product_id: "P-004", product_name: "Producto por agotarse", current_stock: 20, unit_cost: 105, lead_time_days: 15 },
  { product_id: "P-005", product_name: "Producto descontinuado", current_stock: 140, unit_cost: 88, lead_time_days: 10 },
  { product_id: "P-006", product_name: "Producto estacional detenido", current_stock: 95, unit_cost: 140, lead_time_days: 20 },
];

/**
 * Los mismos datos exportados como los entregaría un sistema administrativo:
 * punto y coma, encabezados en español, fechas dd/mm/aaaa y montos con símbolo
 * de moneda. Sirven para demostrar la lectura automática de archivos.
 */
export function demoFiles(): { name: string; buffer: Buffer }[] {
  const dayMonthYear = (iso: string): string => {
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  };

  const amount = (value: number): string =>
    `L ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const salesLines = [
    "Reporte de ventas por artículo",
    "Empresa demostración S. de R.L.",
    "",
    "FECHAEMISION;COD_ARTICULO;DESCRIPCION;CANT;PRECIO_UNIT;COSTO_UNIT;CLIENTE",
    ...demoSales.map((row) =>
      [
        dayMonthYear(row.sale_date),
        row.product_id,
        row.product_name,
        String(row.quantity),
        amount(row.unit_price),
        amount(row.unit_cost),
        row.customer_id ?? "",
      ].join(";"),
    ),
  ];

  const inventoryLines = [
    "Código,Descripción del producto,Existencia actual,Costo promedio,Días de reposición",
    ...demoInventory.map((row) =>
      [
        row.product_id,
        row.product_name,
        String(row.current_stock),
        row.unit_cost.toFixed(2),
        String(row.lead_time_days),
      ].join(","),
    ),
  ];

  return [
    { name: "ventas_sistema.csv", buffer: Buffer.from(salesLines.join("\n"), "utf8") },
    { name: "existencias.csv", buffer: Buffer.from(inventoryLines.join("\n"), "utf8") },
  ];
}

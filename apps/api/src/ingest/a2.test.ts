/**
 * Lectura de exportaciones con la convención de a2.
 *
 * Los nombres de columna llevan el prefijo del tipo de dato de la base de datos
 * (`c_`, `n_`, `d_`), las descripciones vienen abreviadas y hay una columna con
 * el tipo de documento que distingue facturas de notas de crédito, de
 * presupuestos y de entradas de almacén.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { classifyDocument } from "./fields.js";
import { ingestFiles } from "./index.js";
import { stripTypePrefix } from "./values.js";

function file(name: string, content: string, encoding: BufferEncoding = "utf8") {
  return { name, buffer: Buffer.from(content, encoding) };
}

const A2_SALES = [
  "c_TipoDoc;c_NumeroD;d_Fecha;c_CodClie;c_CodArt;c_Descri;n_Cantidad;n_Precio;n_CostoAct",
  "FAC;000001;01/03/2026;CLI-01;ART-01;ACEITE VEGETAL 1L;10;45,50;32,00",
  "FAC;000002;02/03/2026;CLI-02;ART-01;ACEITE VEGETAL 1L;6;45,50;32,00",
  "FAC;000003;03/03/2026;CLI-03;ART-02;ARROZ BLANCO 5LB;4;90,00;70,00",
].join("\n");

const A2_INVENTORY = [
  "c_CodArt;c_Descri;n_Existen;n_CostoAct;n_Precio1;c_Deposito;n_DiasRep",
  "ART-01;ACEITE VEGETAL 1L;40;32,00;45,50;PRINCIPAL;12",
  "ART-02;ARROZ BLANCO 5LB;300;70,00;90,00;PRINCIPAL;9",
].join("\n");

test("reconoce los nombres de columna con el prefijo de tipo de a2", () => {
  const outcome = ingestFiles([
    file("a2_ventas.csv", A2_SALES),
    file("a2_inventario.csv", A2_INVENTORY),
  ]);

  const sales = outcome.report.tables.find((table) => table.role === "sales");
  const inventory = outcome.report.tables.find((table) => table.role === "inventory");
  assert.ok(sales && inventory);

  const field = (report: typeof sales, column: string) =>
    report.mappings.find((mapping) => mapping.column === column)?.field;

  assert.equal(field(sales, "c_CodArt"), "product_id");
  assert.equal(field(sales, "c_Descri"), "product_name");
  assert.equal(field(sales, "d_Fecha"), "sale_date");
  assert.equal(field(sales, "n_Cantidad"), "quantity");
  assert.equal(field(sales, "n_Precio"), "unit_price");
  assert.equal(field(sales, "n_CostoAct"), "unit_cost");
  assert.equal(field(sales, "c_NumeroD"), "sale_id");
  assert.equal(field(sales, "c_CodClie"), "customer_id");

  assert.equal(field(inventory, "n_Existen"), "current_stock");
  assert.equal(field(inventory, "n_Precio1"), "unit_price");
  assert.equal(field(inventory, "n_DiasRep"), "lead_time_days");
  assert.equal(field(inventory, "c_Deposito"), "warehouse");

  // Decimales con coma y miles con punto, como los exporta un a2 en español.
  assert.equal(outcome.sales[0].unit_price, 45.5);
  assert.equal(outcome.sales[0].unit_cost, 32);
  assert.equal(outcome.sales[0].product_id, "ART-01");
  assert.equal(outcome.sales[0].product_name, "ACEITE VEGETAL 1L");
});

test("la nota de crédito resta de las unidades vendidas", () => {
  const withReturn = [
    ...A2_SALES.split("\n"),
    "N/C;000004;05/03/2026;CLI-01;ART-01;ACEITE VEGETAL 1L;3;45,50;32,00",
  ].join("\n");

  const outcome = ingestFiles([file("a2_ventas.csv", withReturn), file("a2_inv.csv", A2_INVENTORY)]);

  const units = outcome.sales
    .filter((sale) => sale.product_id === "ART-01")
    .reduce((sum, sale) => sum + sale.quantity, 0);

  // 10 + 6 vendidas menos 3 devueltas.
  assert.equal(units, 13);

  const returned = outcome.sales.find((sale) => sale.quantity < 0);
  assert.ok(returned);
  assert.equal(returned.quantity, -3);
  // La devolución se expresa como cantidad negativa a precio positivo.
  assert.equal(returned.unit_price, 45.5);
});

test("no vuelve a invertir una devolución que ya viene en negativo", () => {
  const withReturn = [
    ...A2_SALES.split("\n"),
    "N/C;000004;05/03/2026;CLI-01;ART-01;ACEITE VEGETAL 1L;-3;45,50;32,00",
  ].join("\n");

  const outcome = ingestFiles([file("a2_ventas.csv", withReturn), file("a2_inv.csv", A2_INVENTORY)]);
  const units = outcome.sales
    .filter((sale) => sale.product_id === "ART-01")
    .reduce((sum, sale) => sum + sale.quantity, 0);

  assert.equal(units, 13);
});

test("descarta presupuestos y documentos anulados en vez de contarlos como venta", () => {
  const withQuotes = [
    ...A2_SALES.split("\n"),
    "PRE;000004;05/03/2026;CLI-01;ART-01;ACEITE VEGETAL 1L;100;45,50;32,00",
    "ANULADO;000005;06/03/2026;CLI-02;ART-02;ARROZ BLANCO 5LB;50;90,00;70,00",
  ].join("\n");

  const outcome = ingestFiles([file("a2_ventas.csv", withQuotes), file("a2_inv.csv", A2_INVENTORY)]);

  assert.equal(outcome.sales.length, 3);
  assert.ok(outcome.sales.every((sale) => sale.quantity <= 10));

  const report = outcome.report.tables.find((table) => table.role === "sales");
  assert.ok(report);
  assert.equal(report.rowsDiscarded, 2);
  assert.ok(report.issues.some((issue) => /no ser ventas/i.test(issue.message)));
});

test("en un archivo de movimientos descarta las entradas y valora las salidas", () => {
  const movements = [
    "d_Fecha;c_Tipo;c_CodArt;c_Descri;n_Cantidad;n_Costo;c_Deposito",
    "01/03/2026;S;ART-01;ACEITE VEGETAL 1L;10;32,00;PRINCIPAL",
    "02/03/2026;E;ART-01;ACEITE VEGETAL 1L;50;32,00;PRINCIPAL",
    "03/03/2026;S;ART-02;ARROZ BLANCO 5LB;4;70,00;PRINCIPAL",
  ].join("\n");

  const outcome = ingestFiles([
    file("a2_movimientos.csv", movements),
    file("a2_inventario.csv", A2_INVENTORY),
  ]);

  // Solo quedan las dos salidas: la entrada de almacén no es una venta.
  assert.equal(outcome.sales.length, 2);
  assert.ok(outcome.sales.every((sale) => sale.quantity > 0 && sale.quantity <= 10));

  // El movimiento no trae precio de venta: se toma del maestro de artículos.
  const aceite = outcome.sales.find((sale) => sale.product_id === "ART-01");
  assert.ok(aceite);
  assert.equal(aceite.unit_price, 45.5);
  assert.equal(aceite.unit_cost, 32);

  assert.ok(outcome.report.notes.some((note) => /no traían precio/i.test(note)));
});

test("no usa como tipo de documento una columna que no contiene tipos conocidos", () => {
  const content = [
    "d_Fecha;c_Tipo;c_CodArt;c_Descri;n_Cantidad;n_Precio;n_Costo",
    "01/03/2026;LIMPIEZA;ART-01;ACEITE VEGETAL 1L;10;45,50;32,00",
    "02/03/2026;ABARROTES;ART-02;ARROZ BLANCO 5LB;4;90,00;70,00",
  ].join("\n");

  const outcome = ingestFiles([file("ventas.csv", content)]);

  const report = outcome.report.tables.find((table) => table.role === "sales");
  assert.ok(report);
  assert.ok(!report.mappings.some((mapping) => mapping.field === "document_type"));

  // Ninguna venta se descarta por una lectura equivocada de esa columna.
  assert.equal(outcome.sales.length, 2);
});

test("sigue leyendo un archivo genérico bien estructurado", () => {
  const content = [
    "fecha,producto,descripcion,cantidad,precio,costo",
    "2026-03-01,SKU-1,Aceite vegetal 1L,10,45.50,32.00",
    "2026-03-02,SKU-2,Arroz blanco 5lb,4,90.00,70.00",
  ].join("\n");

  const outcome = ingestFiles([file("ventas.csv", content)]);

  assert.equal(outcome.sales.length, 2);
  assert.equal(outcome.sales[0].product_id, "SKU-1");
  assert.equal(outcome.sales[0].product_name, "Aceite vegetal 1L");
  assert.equal(outcome.sales[0].unit_price, 45.5);
});

test("quita el prefijo de tipo sin romper nombres legítimos", () => {
  assert.equal(stripTypePrefix("c_Codigo"), "Codigo");
  assert.equal(stripTypePrefix("n_Cantidad"), "Cantidad");
  assert.equal(stripTypePrefix("d_Fecha"), "Fecha");
  assert.equal(stripTypePrefix("id_producto"), "id_producto");
  assert.equal(stripTypePrefix("codigo_producto"), "codigo_producto");
  assert.equal(stripTypePrefix("Cantidad"), "Cantidad");
});

test("clasifica los tipos de documento más comunes", () => {
  assert.equal(classifyDocument("FAC"), "sale");
  assert.equal(classifyDocument("Factura de venta"), "sale");
  assert.equal(classifyDocument("S"), "sale");
  assert.equal(classifyDocument("N/C"), "return");
  assert.equal(classifyDocument("Nota de credito"), "return");
  assert.equal(classifyDocument("DEV"), "return");
  assert.equal(classifyDocument("E"), "entry");
  assert.equal(classifyDocument("Compra"), "entry");
  assert.equal(classifyDocument("PRE"), "not_a_sale");
  assert.equal(classifyDocument("Cotizacion"), "not_a_sale");
  assert.equal(classifyDocument("ANULADA"), "not_a_sale");

  // "Crédito" a secas es la condición de pago de una venta, no una devolución.
  assert.equal(classifyDocument("CREDITO"), "sale");
  assert.equal(classifyDocument("Contado"), "sale");

  assert.equal(classifyDocument("cualquier cosa"), "unknown");
  assert.equal(classifyDocument(""), "unknown");
});

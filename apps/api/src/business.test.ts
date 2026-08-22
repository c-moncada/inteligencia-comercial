import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBusinessData } from "./analyze.js";
import {
  buildBusinessOverview,
  buildTimeline,
  isSlowMoving,
  sellThroughPercent,
  turnsPerYear,
} from "./business.js";
import { demoInventory, demoSales } from "./demo.js";
import type { ProductRanking, RankingId } from "./types.js";

function overview() {
  const financial = analyzeBusinessData(demoSales, demoInventory);
  return buildBusinessOverview(financial, demoSales, true);
}

function ranking(id: RankingId): ProductRanking {
  const found = overview().rankings.find((item) => item.id === id);
  assert.ok(found, `falta la lista ${id}`);
  return found;
}

test("resume la salud del negocio con un puntaje y sus motivos", () => {
  const result = overview();

  assert.ok(result.health.score >= 0 && result.health.score <= 100);
  assert.ok(["good", "watch", "risk"].includes(result.health.level));
  assert.ok(result.health.headline.length > 0);
  assert.ok(result.health.points.length >= 3);
  assert.ok(result.health.points.some((point) => point.id === "margin"));
  assert.ok(result.health.points.some((point) => point.id === "idle_capital"));
});

test("reparte el inventario entre lo que rota, lo que sobra y lo detenido", () => {
  const financial = analyzeBusinessData(demoSales, demoInventory);
  const { inventoryBreakdown } = buildBusinessOverview(financial, demoSales, true);

  assert.ok(inventoryBreakdown.dead > 0);
  assert.ok(inventoryBreakdown.excess > 0);
  assert.equal(
    Math.round(inventoryBreakdown.healthy + inventoryBreakdown.excess + inventoryBreakdown.dead),
    Math.round(inventoryBreakdown.total),
  );
  assert.equal(Math.round(inventoryBreakdown.total), Math.round(financial.summary.inventoryValue));
});

test("la lista de mayor rotación se ordena por veces al año y deja fuera lo detenido", () => {
  const fast = ranking("fast_moving");

  assert.equal(fast.metric, "turns_per_year");
  assert.ok(fast.items.length > 0);

  const values = fast.items.map((item) => item.value);
  assert.deepEqual(values, [...values].sort((left, right) => right - left));

  // El producto estacional lleva 150 días sin venderse: rota en el promedio del
  // período, pero no pertenece a una lista de productos que se mueven.
  assert.ok(!fast.items.some((item) => item.productId === "P-006"));
  assert.ok(!fast.items.some((item) => item.productId === "P-005"));
});

test("la lista de mayor margen ordena por margen y excluye lo que no tiene costo", () => {
  const financial = analyzeBusinessData(demoSales, demoInventory, {
    productsWithoutCost: ["P-001"],
  });
  const result = buildBusinessOverview(financial, demoSales, true);
  const margin = result.rankings.find((item) => item.id === "high_margin");

  assert.ok(margin);
  assert.equal(margin.metric, "margin_percent");
  assert.ok(!margin.items.some((item) => item.productId === "P-001"));

  const values = margin.items.map((item) => item.value);
  assert.deepEqual(values, [...values].sort((left, right) => right - left));
});

test("la lista de baja rotación ordena por el dinero detenido", () => {
  const slow = ranking("slow_moving");

  assert.equal(slow.metric, "idle_capital");
  assert.ok(slow.items.some((item) => item.productId === "P-005"));
  assert.ok(slow.items.some((item) => item.productId === "P-006"));
  assert.ok(slow.items.every((item) => item.inventoryValue > 0));

  const values = slow.items.map((item) => item.value);
  assert.deepEqual(values, [...values].sort((left, right) => right - left));
});

test("la lista de mayor ganancia coincide con la clasificación A", () => {
  const top = ranking("top_profit");

  assert.equal(top.metric, "gross_profit");
  assert.ok(top.items.length > 0);
  assert.equal(top.items[0].abcClass, "A");
});

test("sin costo en ningún producto la lista de margen explica por qué está vacía", () => {
  const ids = demoInventory.map((item) => item.product_id);
  const financial = analyzeBusinessData(demoSales, demoInventory, { productsWithoutCost: ids });
  const result = buildBusinessOverview(financial, demoSales, true);
  const margin = result.rankings.find((item) => item.id === "high_margin");

  assert.ok(margin);
  assert.equal(margin.items.length, 0);
  assert.match(margin.emptyMessage, /costo/i);
});

test("agrupa la línea de tiempo según el largo del período", () => {
  const weekly = buildTimeline(demoSales, true);
  assert.equal(weekly.granularity, "week");
  assert.ok(weekly.points.length > 4);
  assert.ok(weekly.points.every((point) => point.revenue >= 0));

  const totalRevenue = weekly.points.reduce((sum, point) => sum + point.revenue, 0);
  const expected = demoSales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  assert.ok(Math.abs(totalRevenue - expected) < 1);

  const oneMonth = demoSales.filter((sale) => sale.sale_date.startsWith("2026-01"));
  assert.equal(buildTimeline(oneMonth, true).granularity, "day");
});

test("no dibuja línea de tiempo cuando los datos no traen fechas", () => {
  const timeline = buildTimeline(demoSales, false);
  assert.equal(timeline.points.length, 0);
});

test("calcula rotación y venta sobre lo disponible por producto", () => {
  const financial = analyzeBusinessData(demoSales, demoInventory);
  const seasonal = financial.products.find((item) => item.productId === "P-006");
  const abandoned = financial.products.find((item) => item.productId === "P-005");

  assert.ok(seasonal && abandoned);
  assert.ok((turnsPerYear(seasonal) ?? 0) > 0);
  assert.equal(turnsPerYear(abandoned), 0);
  assert.equal(sellThroughPercent(abandoned), 0);
  assert.equal(isSlowMoving(abandoned), true);
  assert.equal(isSlowMoving(seasonal), true);
});

test("cuenta los productos que se venden y están en cero existencias", () => {
  const inventory = demoInventory.map((item) =>
    item.product_id === "P-004" ? { ...item, current_stock: 0 } : item,
  );
  const financial = analyzeBusinessData(demoSales, inventory);
  const result = buildBusinessOverview(financial, demoSales, true);

  assert.equal(result.outOfStockCount, 1);
  assert.ok(result.highlights.some((line) => line.includes("cero existencias")));
});

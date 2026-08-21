import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBusinessData } from "./analyze.js";
import { demoInventory, demoSales } from "./demo.js";

test("genera resumen e insights financieros", () => {
  const result = analyzeBusinessData(demoSales, demoInventory);

  assert.equal(result.summary.productsAnalyzed, demoInventory.length);
  assert.ok(result.summary.revenue > 0);
  assert.ok(result.summary.trappedCapital > 0);
  assert.ok(result.summary.inventoryValue > 0);
  assert.equal(result.period.assumed, false);
  assert.ok(result.insights.some((item) => item.type === "excess_inventory"));
  assert.ok(result.insights.some((item) => item.type === "stockout_risk"));
  assert.ok(result.insights.some((item) => item.type === "low_margin"));
});

test("incluye los productos que tienen inventario pero ninguna venta", () => {
  const result = analyzeBusinessData(demoSales, demoInventory);
  const abandoned = result.products.find((item) => item.productId === "P-005");

  assert.ok(abandoned);
  assert.equal(abandoned.hasSales, false);
  assert.equal(abandoned.unitsSold, 0);
  assert.ok(abandoned.inventoryValue > 0);
  assert.ok(result.summary.deadStockValue >= abandoned.inventoryValue);
  assert.ok(result.insights.some((item) => item.type === "dead_stock"));
});

test("detecta productos que dejaron de venderse", () => {
  const result = analyzeBusinessData(demoSales, demoInventory);
  const seasonal = result.products.find((item) => item.productId === "P-006");

  assert.ok(seasonal);
  assert.equal(seasonal.hasSales, true);
  assert.ok((seasonal.daysSinceLastSale ?? 0) > 60);
  assert.equal(seasonal.trend, "cayendo");
});

test("clasifica los productos por su aporte a la ganancia", () => {
  const result = analyzeBusinessData(demoSales, demoInventory);

  assert.ok(result.products.every((item) => ["A", "B", "C"].includes(item.abcClass)));
  assert.equal(result.products[0].abcClass, "A");
  const shares = result.products.reduce((sum, item) => sum + item.profitShare, 0);
  assert.ok(shares > 99 && shares < 101);
});

test("usa el período asumido cuando los datos no traen fechas reales", () => {
  const sales = demoSales.slice(0, 20).map((sale) => ({ ...sale, sale_date: "2026-08-01" }));
  const result = analyzeBusinessData(sales, demoInventory, { periodDaysOverride: 30 });

  assert.equal(result.period.assumed, true);
  assert.equal(result.period.days, 30);
  assert.ok(result.products.every((item) => item.daysSinceLastSale === null));
  assert.ok(result.products.every((item) => item.trend === "sin datos"));
});

test("marca los productos sin costo y no les calcula margen", () => {
  const sales = demoSales.map((sale) => ({ ...sale, unit_cost: sale.unit_price }));
  const result = analyzeBusinessData(sales, demoInventory, {
    productsWithoutCost: ["P-001"],
  });

  const product = result.products.find((item) => item.productId === "P-001");
  assert.ok(product);
  assert.equal(product.costKnown, false);
  assert.equal(result.summary.productsWithoutCost, 1);
  assert.ok(!result.insights.some((item) => item.type === "low_margin" && item.productId === "P-001"));
});

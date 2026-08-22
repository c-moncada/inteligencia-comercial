import assert from "node:assert/strict";
import test from "node:test";
import { appendAll, maxOf, minOf } from "./numbers.js";

/**
 * El tamaño importa: con `Math.max(...valores)` un archivo de ventas de un año
 * hacía fallar el análisis con "Maximum call stack size exceeded". Estas
 * pruebas fijan que las listas grandes ya no revientan.
 */
const LARGE = 200_000;

test("encuentra el máximo y el mínimo en listas de cientos de miles de valores", () => {
  const values = Array.from({ length: LARGE }, (_, index) => index);
  values[12_345] = -7;
  values[98_765] = LARGE + 99;

  assert.equal(maxOf(values), LARGE + 99);
  assert.equal(minOf(values), -7);
});

test("agrega listas grandes sin desbordar la pila", () => {
  const target: number[] = [];
  const source = Array.from({ length: LARGE }, (_, index) => index);

  appendAll(target, source);

  assert.equal(target.length, LARGE);
  assert.equal(target[0], 0);
  assert.equal(target[LARGE - 1], LARGE - 1);
});

test("se comporta igual que Math.max y Math.min en los casos normales", () => {
  assert.equal(maxOf([3, 9, 4]), Math.max(3, 9, 4));
  assert.equal(minOf([3, 9, 4]), Math.min(3, 9, 4));
  assert.equal(maxOf([-5]), -5);
  assert.equal(minOf([-5]), -5);

  // Con la lista vacía se conserva el mismo resultado que Math.max/Math.min.
  assert.equal(maxOf([]), Number.NEGATIVE_INFINITY);
  assert.equal(minOf([]), Number.POSITIVE_INFINITY);
});

test("no altera el destino cuando la lista de origen está vacía", () => {
  const target = [1, 2];
  appendAll(target, []);
  assert.deepEqual(target, [1, 2]);
});

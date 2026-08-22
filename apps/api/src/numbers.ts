/**
 * Mínimo y máximo sobre listas grandes.
 *
 * `Math.max(...valores)` pasa cada elemento como un argumento distinto, y el
 * motor revienta la pila alrededor de las 100.000 llamadas. Un archivo de
 * ventas de un año lo alcanza sin esfuerzo: pasaba con 150.000 líneas y el
 * análisis fallaba con "Maximum call stack size exceeded".
 *
 * Recorrer la lista no tiene ese techo y cuesta lo mismo.
 */

/** Igual que `Math.max(...values)`: devuelve -Infinity con la lista vacía. */
export function maxOf(values: readonly number[]): number {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value > maximum) maximum = value;
  }
  return maximum;
}

/** Igual que `Math.min(...values)`: devuelve Infinity con la lista vacía. */
export function minOf(values: readonly number[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (value < minimum) minimum = value;
  }
  return minimum;
}

/** Agrega los elementos de `source` a `target` sin usar el operador de propagación. */
export function appendAll<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}

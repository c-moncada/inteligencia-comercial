/**
 * Formato de cifras.
 *
 * Todo el dinero se muestra en lempiras porque es la moneda del negocio que usa
 * la plataforma. Para cambiar de país basta con ajustar estas dos constantes.
 */

const LOCALE = "es-HN";
const CURRENCY = "HNL";

const currencyFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

const currencyExactFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 2,
});

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Dinero para leer de un vistazo: sin centavos. */
export function money(value: number): string {
  return currencyFormat.format(value);
}

/** Dinero con centavos, para cifras que se van a comparar o exportar. */
export function moneyExact(value: number): string {
  return currencyExactFormat.format(value);
}

/** Dinero resumido para etiquetas de gráficos: 1.2 M, 45 k. */
export function moneyShort(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `L ${numberFormat.format(value / 1_000_000)} M`;
  if (absolute >= 1_000) return `L ${integerFormat.format(value / 1_000)} k`;
  return `L ${integerFormat.format(value)}`;
}

export function amount(value: number): string {
  return numberFormat.format(value);
}

export function whole(value: number): string {
  return integerFormat.format(value);
}

export function percent(value: number): string {
  return `${numberFormat.format(value)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fecha ISO a texto legible: 2026-03-01 → 1 de marzo de 2026. */
export function longDate(value: string): string {
  const time = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function coverageText(days: number | null): string {
  if (days === null) return "Sin demanda";
  if (days < 1) return "Menos de un día";
  return `${whole(days)} días`;
}

export function lastSaleText(days: number | null, hasSales: boolean): string {
  if (!hasSales) return "Nunca en el período";
  if (days === null) return "Sin fechas";
  if (days === 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}

export function deadlineText(days: number | null): string {
  if (days === null) return "Sin fecha calculada";
  if (days < 0) return `Atrasado ${Math.abs(days)} días`;
  if (days === 0) return "Hoy";
  if (days === 1) return "En 1 día";
  return `En ${days} días`;
}

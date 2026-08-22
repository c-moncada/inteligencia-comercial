import { useMemo, useState } from "react";
import type { AnalysisResult, ProductAnalysis } from "../types";
import { amount, coverageText, lastSaleText, money, percent, whole } from "../lib/format";
import { downloadProducts } from "../lib/csv";

type StatusId = "out_of_stock" | "idle" | "excess" | "restock" | "healthy";

const statusCopy: Record<StatusId, { label: string; help: string }> = {
  out_of_stock: {
    label: "Sin existencia",
    help: "Se vende, pero hoy no hay unidades disponibles.",
  },
  idle: { label: "Detenido", help: "Tiene inventario y no registra ventas recientes." },
  excess: { label: "De más", help: "Hay más inventario del que se venderá en 90 días." },
  restock: { label: "Hay que reponer", help: "El inventario no cubre el tiempo de reposición." },
  healthy: { label: "En orden", help: "Rotación e inventario dentro de lo esperado." },
};

function statusOf(product: ProductAnalysis): StatusId {
  if (product.unitsSold > 0 && product.currentStock <= 0) return "out_of_stock";
  if (
    product.inventoryValue > 0 &&
    (!product.hasSales || (product.daysSinceLastSale !== null && product.daysSinceLastSale >= 60))
  ) {
    return "idle";
  }
  if (product.trappedCapital > 0) return "excess";
  if (product.suggestedPurchase > 0) return "restock";
  return "healthy";
}

function turnsOf(product: ProductAnalysis): number | null {
  if (product.currentStock <= 0) return null;
  return Math.round(((product.averageDailyDemand * 365) / product.currentStock) * 100) / 100;
}

type SortKey =
  | "productName"
  | "revenue"
  | "grossProfit"
  | "marginPercent"
  | "turns"
  | "coverageDays"
  | "daysSinceLastSale"
  | "currentStock"
  | "suggestedPurchase";

const columns: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "productName", label: "Producto", numeric: false },
  { key: "revenue", label: "Ventas", numeric: true },
  { key: "grossProfit", label: "Ganancia", numeric: true },
  { key: "marginPercent", label: "Margen", numeric: true },
  { key: "turns", label: "Rotación anual", numeric: true },
  { key: "coverageDays", label: "Te alcanza para", numeric: true },
  { key: "daysSinceLastSale", label: "Última venta", numeric: true },
  { key: "currentStock", label: "Existencia", numeric: true },
  { key: "suggestedPurchase", label: "Comprar", numeric: true },
];

function sortValue(product: ProductAnalysis, key: SortKey): number | string {
  if (key === "productName") return product.productName.toLowerCase();
  if (key === "turns") return turnsOf(product) ?? -1;
  if (key === "coverageDays") return product.coverageDays ?? Number.MAX_SAFE_INTEGER;
  if (key === "daysSinceLastSale") return product.daysSinceLastSale ?? Number.MAX_SAFE_INTEGER;
  return product[key];
}

type FilterId = "all" | StatusId | "class_a" | "no_cost";

export function ProductExplorer({
  result,
  search,
  onSearchChange,
}: {
  result: AnalysisResult;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [sortKey, setSortKey] = useState<SortKey>("grossProfit");
  const [ascending, setAscending] = useState(false);

  const statuses = useMemo(() => {
    const map = new Map<string, StatusId>();
    for (const product of result.products) map.set(product.productId, statusOf(product));
    return map;
  }, [result.products]);

  const counts = useMemo(() => {
    const map = new Map<StatusId, number>();
    for (const status of statuses.values()) map.set(status, (map.get(status) ?? 0) + 1);
    return map;
  }, [statuses]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = result.products.filter((product) => {
      if (term) {
        const haystack = `${product.productName} ${product.productId}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (filter === "all") return true;
      if (filter === "class_a") return product.abcClass === "A";
      if (filter === "no_cost") return !product.costKnown;
      return statuses.get(product.productId) === filter;
    });

    return [...filtered].sort((left, right) => {
      const leftValue = sortValue(left, sortKey);
      const rightValue = sortValue(right, sortKey);
      const comparison =
        typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue.localeCompare(rightValue, "es")
          : Number(leftValue) - Number(rightValue);
      return ascending ? comparison : -comparison;
    });
  }, [result.products, search, filter, statuses, sortKey, ascending]);

  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setAscending((current) => !current);
      return;
    }
    setSortKey(key);
    setAscending(key === "productName");
  }

  const filters: { id: FilterId; label: string; count: number }[] = [
    { id: "all", label: "Todos", count: result.products.length },
    { id: "restock", label: statusCopy.restock.label, count: counts.get("restock") ?? 0 },
    { id: "out_of_stock", label: statusCopy.out_of_stock.label, count: counts.get("out_of_stock") ?? 0 },
    { id: "excess", label: statusCopy.excess.label, count: counts.get("excess") ?? 0 },
    { id: "idle", label: statusCopy.idle.label, count: counts.get("idle") ?? 0 },
    { id: "class_a", label: "Clase A", count: result.products.filter((p) => p.abcClass === "A").length },
    { id: "no_cost", label: "Sin costo", count: result.summary.productsWithoutCost },
  ];

  return (
    <div className="tab-panel">
      <div className="explorer-toolbar">
        <label className="search">
          <span className="visually-hidden">Buscar producto</span>
          <input
            type="search"
            value={search}
            placeholder="Buscar por nombre o código…"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        <div className="filters" role="group" aria-label="Filtrar productos">
          {filters
            .filter((item) => item.id === "all" || item.count > 0)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? "filter is-active" : "filter"}
                onClick={() => setFilter(item.id)}
              >
                {item.label} ({item.count})
              </button>
            ))}
        </div>

        <button type="button" className="ghost" onClick={() => downloadProducts(result)}>
          Descargar
        </button>
      </div>

      <p className="explorer-count">
        Mostrando {visible.length} de {result.products.length} productos.
        {search.trim() ? (
          <button type="button" className="link" onClick={() => onSearchChange("")}>
            Limpiar búsqueda
          </button>
        ) : null}
      </p>

      <div className="table-wrapper">
        <table className="product-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.numeric ? "numeric" : ""}
                  aria-sort={
                    sortKey === column.key ? (ascending ? "ascending" : "descending") : "none"
                  }
                >
                  <button type="button" onClick={() => sortBy(column.key)}>
                    {column.label}
                    {sortKey === column.key ? <span>{ascending ? " ▲" : " ▼"}</span> : null}
                  </button>
                </th>
              ))}
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const status = statuses.get(product.productId) ?? "healthy";
              const turns = turnsOf(product);

              return (
                <tr key={product.productId}>
                  <td className="product-cell">
                    <strong>{product.productName}</strong>
                    <small>
                      {product.productId}
                      {product.abcClass === "A" ? " · Clase A" : ""}
                      {product.costKnown ? "" : " · sin costo en los archivos"}
                    </small>
                  </td>
                  <td className="numeric">{money(product.revenue)}</td>
                  <td className="numeric">{money(product.grossProfit)}</td>
                  <td className="numeric">{percent(product.marginPercent)}</td>
                  <td className="numeric">
                    {turns === null ? "—" : `${amount(turns)} veces`}
                  </td>
                  <td className="numeric">{coverageText(product.coverageDays)}</td>
                  <td className="numeric">
                    {lastSaleText(product.daysSinceLastSale, product.hasSales)}
                  </td>
                  <td className="numeric">{whole(product.currentStock)}</td>
                  <td className="numeric">
                    {product.suggestedPurchase > 0 ? whole(product.suggestedPurchase) : "—"}
                  </td>
                  <td>
                    <span className={`status status-${status}`} title={statusCopy[status].help}>
                      {statusCopy[status].label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? (
        <p className="notice">Ningún producto coincide con la búsqueda o el filtro elegido.</p>
      ) : null}
    </div>
  );
}

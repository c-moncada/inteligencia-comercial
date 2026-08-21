/**
 * Diccionario de campos canónicos y de los nombres con que aparecen en las
 * exportaciones reales: sistemas contables, puntos de venta y hojas propias.
 */

import { slug } from "./values.js";

export type CanonicalField =
  | "product_id"
  | "product_name"
  | "sale_date"
  | "expiry_date"
  | "quantity"
  | "unit_price"
  | "unit_cost"
  | "line_total"
  | "line_cost_total"
  | "sale_id"
  | "customer_id"
  | "current_stock"
  | "lead_time_days"
  | "min_stock"
  | "discount"
  | "margin_percent"
  | "category"
  | "warehouse";

export type FieldKind = "text" | "code" | "number" | "money" | "date";
export type FieldScope = "sales" | "inventory" | "both";

export interface FieldDefinition {
  field: CanonicalField;
  label: string;
  kind: FieldKind;
  scope: FieldScope;
  aliases: string[];
}

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    field: "product_id",
    label: "Código de producto",
    kind: "code",
    scope: "both",
    aliases: [
      "product id", "productid", "id producto", "producto id", "codigo", "codigo producto",
      "cod producto", "codprod", "cod prod", "sku", "item code", "itemcode", "cod item",
      "codigo item", "codigo articulo", "cod articulo", "articulo id", "referencia", "ref",
      "clave", "clave producto", "upc", "ean", "codigo de barras", "codigo barras", "barcode",
      "material", "codigo interno", "no articulo", "numero articulo", "codigo sap",
      "codigo del producto", "cod", "id item", "part number", "partnumber",
    ],
  },
  {
    field: "product_name",
    label: "Nombre del producto",
    kind: "text",
    scope: "both",
    aliases: [
      "producto", "descripcion", "descripcion producto", "descripcion del producto",
      "nombre", "nombre producto", "nombre del producto", "detalle", "articulo",
      "descripcion articulo", "product name", "productname", "product", "description",
      "denominacion", "concepto", "material description", "nombre articulo", "item",
      "descripcion item", "producto nombre",
    ],
  },
  {
    field: "sale_date",
    label: "Fecha de venta",
    kind: "date",
    scope: "sales",
    aliases: [
      "fecha", "fecha venta", "fecha de venta", "fecha factura", "fecha de factura",
      "fecha emision", "fechaemision", "fecha de emision", "fecha documento",
      "fecha movimiento", "fecha operacion", "fecha registro", "sale date", "saledate",
      "invoice date", "order date", "date", "dia", "emision", "periodo", "fec", "fec emision",
      "fecha hora", "timestamp", "created at", "fecha transaccion",
    ],
  },
  {
    // No se usa en el análisis, pero debe reconocerse para que una fecha de
    // vencimiento no se confunda con la fecha de venta.
    field: "expiry_date",
    label: "Fecha de vencimiento",
    kind: "date",
    scope: "inventory",
    aliases: [
      "fecha vencimiento", "fecha de vencimiento", "vencimiento", "vence",
      "caducidad", "fecha caducidad", "fecha de caducidad", "expiracion",
      "fecha expiracion", "expiry", "expiry date", "expiration date", "best before",
    ],
  },
  {
    field: "quantity",
    label: "Cantidad vendida",
    kind: "number",
    scope: "sales",
    aliases: [
      "cantidad", "cant", "cantidad vendida", "cant vendida", "unidades", "unidades vendidas",
      "qty", "quantity", "cantidad facturada", "piezas", "pzas", "salida", "salidas",
      "cantidad salida", "unid", "und", "vendido", "vendidos", "quantity sold", "volumen",
      "cantidad unidades", "num unidades",
    ],
  },
  {
    field: "unit_price",
    label: "Precio unitario",
    kind: "money",
    scope: "both",
    aliases: [
      "precio", "precio unitario", "precio unit", "precio venta", "precio de venta",
      "p unitario", "punitario", "unit price", "unitprice", "price", "pvp", "valor unitario",
      "precio neto", "precio lista", "importe unitario", "precio publico", "precio final",
      "sale price", "selling price",
    ],
  },
  {
    field: "unit_cost",
    label: "Costo unitario",
    kind: "money",
    scope: "both",
    aliases: [
      "costo", "costo unitario", "costo unit", "c unitario", "cunitario", "unit cost",
      "unitcost", "cost", "costo promedio", "costo ultimo", "costo compra", "costo de compra",
      "precio costo", "costo actual", "costo estandar", "valor costo", "average cost",
      "costo prom", "precio compra", "precio de compra", "valor compra", "purchase price",
      "costo adquisicion", "precio proveedor",
    ],
  },
  {
    field: "line_total",
    label: "Importe de la línea",
    kind: "money",
    scope: "sales",
    aliases: [
      "total", "importe", "subtotal", "monto", "monto total", "valor total", "total linea",
      "total venta", "venta", "ventas", "amount", "line total", "linetotal", "importe neto",
      "total neto", "valor venta", "ingreso", "ingresos", "revenue", "total facturado",
    ],
  },
  {
    field: "line_cost_total",
    label: "Costo total de la línea",
    kind: "money",
    scope: "sales",
    aliases: [
      "costo total", "total costo", "importe costo", "costo de venta", "costo de ventas",
      "cogs", "valor costo total", "total cost",
    ],
  },
  {
    field: "sale_id",
    label: "Documento de venta",
    kind: "code",
    scope: "sales",
    aliases: [
      "factura", "no factura", "num factura", "numero factura", "nro factura", "documento",
      "no documento", "num documento", "folio", "ticket", "invoice", "invoice id",
      "invoice number", "sale id", "saleid", "comprobante", "correlativo", "orden",
      "pedido", "transaccion", "movimiento", "fc codigo", "id venta", "boleta",
    ],
  },
  {
    field: "customer_id",
    label: "Cliente",
    kind: "code",
    scope: "sales",
    aliases: [
      "cliente", "codigo cliente", "cod cliente", "id cliente", "customer", "customer id",
      "customerid", "nit", "rtn", "ruc", "cedula", "razon social", "nombre cliente",
      "client", "cliente id",
    ],
  },
  {
    field: "current_stock",
    label: "Existencia actual",
    kind: "number",
    scope: "inventory",
    aliases: [
      "existencia", "existencias", "stock", "stock actual", "saldo", "saldo actual",
      "inventario", "inventario actual", "disponible", "cantidad disponible",
      "unidades disponibles", "on hand", "onhand", "quantity on hand", "exist",
      "cant existencia", "stock disponible", "saldo inventario", "existencia actual",
      "current stock", "stock on hand",
    ],
  },
  {
    field: "lead_time_days",
    label: "Días de reposición",
    kind: "number",
    scope: "inventory",
    aliases: [
      "lead time", "leadtime", "lead time days", "dias reposicion", "dias de reposicion",
      "tiempo entrega", "tiempo de entrega", "dias entrega", "dias de entrega",
      "plazo entrega", "plazo de entrega", "dias proveedor", "tiempo reposicion",
      "dias espera", "delivery days",
    ],
  },
  {
    field: "min_stock",
    label: "Existencia mínima",
    kind: "number",
    scope: "inventory",
    aliases: [
      "stock minimo", "existencia minima", "minimo", "cantidad minima", "punto de reorden",
      "punto reorden", "reorder point", "min stock", "minimum stock",
    ],
  },
  {
    field: "discount",
    label: "Descuento",
    kind: "money",
    scope: "sales",
    aliases: ["descuento", "dcto", "discount", "descuentos", "rebaja"],
  },
  {
    field: "margin_percent",
    label: "Margen",
    kind: "number",
    scope: "both",
    aliases: [
      "margen", "margen porcentaje", "porcentaje margen", "margin", "margin percent",
      "utilidad porcentaje", "porcentaje utilidad", "margen bruto",
    ],
  },
  {
    field: "category",
    label: "Categoría",
    kind: "text",
    scope: "both",
    aliases: [
      "categoria", "familia", "linea", "grupo", "clasificacion", "departamento", "marca",
      "category", "family", "brand", "rubro",
    ],
  },
  {
    field: "warehouse",
    label: "Bodega o sucursal",
    kind: "text",
    scope: "both",
    aliases: [
      "bodega", "almacen", "sucursal", "tienda", "local", "warehouse", "store", "centro",
      "punto de venta",
    ],
  },
];

export const FIELDS_BY_NAME = new Map<CanonicalField, FieldDefinition>(
  FIELD_DEFINITIONS.map((definition) => [definition.field, definition]),
);

/** Índice de alias normalizados hacia su campo canónico. */
export const ALIAS_INDEX = new Map<string, CanonicalField>();
for (const definition of FIELD_DEFINITIONS) {
  ALIAS_INDEX.set(slug(definition.field), definition.field);
  for (const alias of definition.aliases) {
    const key = slug(alias);
    if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, definition.field);
  }
}

export function fieldLabel(field: CanonicalField): string {
  return FIELDS_BY_NAME.get(field)?.label ?? field;
}

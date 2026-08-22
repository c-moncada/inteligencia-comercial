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
  | "document_type"
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
      // Nombres cortos típicos de a2 y de otros administrativos que exportan
      // directamente los campos de su base de datos.
      "codart", "cod art", "codigoart", "codart1", "codprincipal", "codigo principal",
      "reng codigo", "renglon codigo", "art", "articulo codigo", "codbarra",
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
      "descri", "descrip", "descripcio", "descripcion1", "nombre art",
      "descripcion larga", "descripcion corta", "art descripcion",
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
      "fechad", "fecha d", "fechadoc", "fecha doc", "fecha del documento",
      "fecha mov", "fechamov",
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
      "cantd", "cant desp", "cantidad despachada", "despachado", "cantidad1",
      "cant fact", "unidades despachadas",
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
      "preciod", "precio1", "precio 1", "preciounit", "precio unitario1",
      "precio detal", "precio mayor",
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
      "costoact", "costo act", "ultimo costo", "costo ult", "costoant",
      "costo anterior", "costo prom1", "costo1",
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
      "numerod", "numero d", "numero documento", "nro doc", "num doc", "ndoc",
      "control", "numero control", "nro control",
    ],
  },
  {
    /**
     * Tipo de documento o de movimiento.
     *
     * Sin él una nota de crédito se suma como venta y un presupuesto inventa
     * ventas que nunca ocurrieron. a2 y los administrativos parecidos siempre
     * traen esta columna en los renglones de factura y en los movimientos de
     * almacén.
     */
    field: "document_type",
    label: "Tipo de documento",
    kind: "text",
    scope: "sales",
    aliases: [
      "tipo", "tipo documento", "tipo de documento", "tipodoc", "tipo doc",
      "tipo comprobante", "clase documento", "clase de documento", "doc tipo",
      "tipo movimiento", "tipo de movimiento", "tipo mov", "tipomov",
      "tipo operacion", "tipo transaccion", "naturaleza", "signo",
      "document type", "movement type", "transaction type",
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
      "codclie", "cod clie", "codcli", "clidesc", "rif", "razon social cliente",
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
      "existen", "existe", "existencia1", "exist actual",
      "stock1", "saldo final", "existencia final",
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
      "diasrep", "dias rep", "diasreposicion", "dias prov", "tiempo prov",
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
      "punto de venta", "deposito", "dep", "coddeposito", "cod deposito", "codalmacen",
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

/**
 * Qué representa una fila según su tipo de documento.
 *
 * - `sale`: factura, salida de almacén, nota de entrega. Suma a la venta.
 * - `return`: nota de crédito o devolución. Resta de la venta.
 * - `entry`: compra o entrada de almacén. No es venta y se descarta.
 * - `not_a_sale`: presupuesto, cotización, pedido o documento anulado.
 * - `unknown`: no se reconoció; la fila se trata como venta normal.
 */
export type DocumentKind = "sale" | "return" | "entry" | "not_a_sale" | "unknown";

/** Códigos cortos, tal como los escriben los sistemas administrativos. */
const DOCUMENT_CODES: Record<string, DocumentKind> = {
  fac: "sale", f: "sale", fv: "sale", fact: "sale", facv: "sale", v: "sale",
  s: "sale", sal: "sale", ne: "sale", tk: "sale", fc: "sale", vta: "sale",
  nc: "return", ncr: "return", dev: "return", devo: "return", d: "return",
  e: "entry", ent: "entry", com: "entry", cmp: "entry", c: "entry",
  pre: "not_a_sale", pres: "not_a_sale", cot: "not_a_sale", ped: "not_a_sale",
  pd: "not_a_sale", anu: "not_a_sale", nul: "not_a_sale",
};

/**
 * Palabras completas. Se revisan por orden: lo más específico primero, porque
 * "nota de credito" contiene "credito", que por sí solo es una condición de
 * pago y no una devolución.
 */
const DOCUMENT_WORDS: { needle: string; kind: DocumentKind }[] = [
  { needle: "notadecredito", kind: "return" },
  { needle: "notacredito", kind: "return" },
  { needle: "devolucion", kind: "return" },
  { needle: "devuelto", kind: "return" },
  { needle: "creditnote", kind: "return" },
  { needle: "return", kind: "return" },

  { needle: "presupuesto", kind: "not_a_sale" },
  { needle: "cotizacion", kind: "not_a_sale" },
  { needle: "proforma", kind: "not_a_sale" },
  { needle: "pedido", kind: "not_a_sale" },
  { needle: "ordendecompra", kind: "not_a_sale" },
  { needle: "anulad", kind: "not_a_sale" },
  { needle: "borrador", kind: "not_a_sale" },
  { needle: "quote", kind: "not_a_sale" },

  { needle: "compra", kind: "entry" },
  { needle: "entrada", kind: "entry" },
  { needle: "cargo", kind: "entry" },
  { needle: "recepcion", kind: "entry" },
  { needle: "ajustepositivo", kind: "entry" },
  { needle: "purchase", kind: "entry" },

  { needle: "notadeentrega", kind: "sale" },
  { needle: "notaentrega", kind: "sale" },
  { needle: "factura", kind: "sale" },
  { needle: "despacho", kind: "sale" },
  { needle: "descargo", kind: "sale" },
  { needle: "salida", kind: "sale" },
  { needle: "venta", kind: "sale" },
  { needle: "contado", kind: "sale" },
  { needle: "credito", kind: "sale" },
  { needle: "ticket", kind: "sale" },
  { needle: "invoice", kind: "sale" },
  { needle: "sale", kind: "sale" },
];

/** Interpreta el valor de la columna de tipo de documento. */
export function classifyDocument(value: string): DocumentKind {
  const key = slug(value);
  if (!key) return "unknown";

  // Un "-1" o "-" en la columna de signo también marca una devolución.
  const trimmed = value.trim();
  if (trimmed === "-1" || trimmed === "-") return "return";
  if (trimmed === "1" || trimmed === "+") return "sale";

  for (const { needle, kind } of DOCUMENT_WORDS) {
    if (key.includes(needle)) return kind;
  }

  return DOCUMENT_CODES[key] ?? "unknown";
}

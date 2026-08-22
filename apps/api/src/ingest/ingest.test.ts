import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, crc32 } from "node:zlib";
import { IngestError, ingestFiles } from "./index.js";
import { parseDate, parseNumber } from "./values.js";

function file(name: string, content: string, encoding: BufferEncoding = "utf8") {
  return { name, buffer: Buffer.from(content, encoding) };
}

/** Construye un .xlsx real en memoria para probar el lector de Excel. */
function xlsx(rows: (string | number)[][]): Buffer {
  const columnLetter = (index: number): string => {
    let letters = "";
    let current = index;
    while (current >= 0) {
      letters = String.fromCharCode((current % 26) + 65) + letters;
      current = Math.floor(current / 26) - 1;
    }
    return letters;
  };

  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const reference = `${columnLetter(columnIndex)}${rowIndex + 1}`;
          return typeof value === "number"
            ? `<c r="${reference}"><v>${value}</v></c>`
            : `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const entries: [string, string][] = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Existencias" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ];

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const raw = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);
    const nameBuffer = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

test("lee un CSV con membrete, punto y coma, fechas dd/mm/aaaa y montos con moneda", () => {
  const outcome = ingestFiles([
    file(
      "reporte.csv",
      [
        "REPORTE DE VENTAS",
        "Empresa demo;;;;",
        "",
        "FECHAEMISION;COD_ARTICULO;DESCRIPCION;CANT;PRECIO_UNIT;COSTO_UNIT",
        "01/03/2026;A-1;Aceite vegetal;3;L 1,250.50;L 900.00",
        "02/03/2026;A-1;Aceite vegetal;5;L 1,250.50;L 900.00",
        "03/03/2026;A-2;Arroz;2;L 120.00;L 95.00",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.sales.length, 3);
  assert.equal(outcome.sales[0].sale_date, "2026-03-01");
  assert.equal(outcome.sales[0].unit_price, 1250.5);
  assert.equal(outcome.sales[0].product_id, "A-1");
  assert.equal(outcome.report.tables[0].headerLine, 3);
  assert.equal(outcome.report.tables[0].delimiter, "punto y coma");
});

test("reconoce las columnas por su contenido cuando el archivo no trae encabezados", () => {
  const outcome = ingestFiles([
    file(
      "sin_encabezado.csv",
      [
        "01/03/2026,ART-1,Aceite vegetal 1L,3,45.50,32.00",
        "02/03/2026,ART-1,Aceite vegetal 1L,5,45.50,32.00",
        "03/03/2026,ART-2,Arroz 5lb,2,120.00,95.00",
        "04/03/2026,ART-2,Arroz 5lb,7,120.00,95.00",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.sales.length, 4);
  assert.equal(outcome.sales[0].product_name, "Aceite vegetal 1L");
  assert.equal(outcome.sales[0].quantity, 3);
  assert.equal(outcome.sales[0].unit_price, 45.5);
  assert.equal(outcome.sales[0].unit_cost, 32);
});

test("interpreta números con coma decimal y punto de miles", () => {
  const outcome = ingestFiles([
    file(
      "europeo.csv",
      [
        "Fecha;Artículo;Descripción;Unidades;Precio;Costo",
        "15-03-2026;A001;Café molido 500g;4;1.234,56;900,00",
        "16-03-2026;A002;Azúcar 5 lb;12;89,90;70,25",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.sales[0].unit_price, 1234.56);
  assert.equal(outcome.sales[0].unit_cost, 900);
  assert.equal(outcome.sales[1].unit_price, 89.9);
  assert.equal(outcome.sales[0].product_id, "A001");
  assert.equal(outcome.sales[0].product_name, "Café molido 500g");
});

test("lee inventario desde un archivo de Excel", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "fecha,codigo,producto,cantidad,precio,costo",
        "2026-03-01,P-1,Camisa,4,350,210",
        "2026-03-02,P-1,Camisa,2,350,210",
      ].join("\n"),
    ),
    {
      name: "inventario.xlsx",
      buffer: xlsx([
        ["Codigo", "Producto", "Existencia", "Costo", "Dias de reposicion"],
        ["P-1", "Camisa", 40, 210, 12],
      ]),
    },
  ]);

  assert.equal(outcome.inventory.length, 1);
  assert.equal(outcome.inventory[0].current_stock, 40);
  assert.equal(outcome.inventory[0].lead_time_days, 12);
  assert.ok(outcome.report.tables.some((table) => table.format === "excel"));
});

test("acepta JSON y deduce precio y costo unitario desde los totales", () => {
  const outcome = ingestFiles([
    file(
      "ventas.json",
      JSON.stringify([
        {
          factura: "F-1",
          fecha: "2026-03-01",
          sku: "X1",
          descripcion: "Producto X",
          cantidad: 4,
          total: 400,
          "costo total": 260,
        },
      ]),
    ),
  ]);

  assert.equal(outcome.sales.length, 1);
  assert.equal(outcome.sales[0].unit_price, 100);
  assert.equal(outcome.sales[0].unit_cost, 65);
  assert.equal(outcome.sales[0].sale_id, "F-1");
});

test("acepta un solo archivo con ventas e inventario sin fechas", () => {
  const outcome = ingestFiles([
    file(
      "resumen.tsv",
      [
        "Producto\tVendidos\tExistencia\tPrecio venta\tCosto unitario",
        "Camisa blanca\t120\t45\t350\t210",
        "Pantalón azul\t80\t200\t720\t480",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.datesDetected, false);
  assert.equal(outcome.assumedPeriodDays, 30);
  assert.equal(outcome.sales.length, 2);
  assert.equal(outcome.inventory.length, 2);
  assert.equal(outcome.report.tables[0].role, "both");
  assert.ok(outcome.report.warnings.some((warning) => warning.includes("no traen fechas")));
});

test("suma las existencias del mismo producto en varias bodegas", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      "fecha,codigo,producto,cantidad,precio,costo\n2026-03-01,P-1,Camisa,4,350,210",
    ),
    file(
      "inventario.csv",
      [
        "codigo,producto,bodega,existencia,costo,dias de entrega",
        "P-1,Camisa,Central,30,210,10",
        "P-1,Camisa,Sucursal,15,210,14",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.inventory.length, 1);
  assert.equal(outcome.inventory[0].current_stock, 45);
  assert.equal(outcome.inventory[0].lead_time_days, 14);
});

test("asume margen cero cuando ningún archivo trae el costo", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "fecha,producto,cantidad,precio",
        "2026-03-01,Camisa,4,350",
        "2026-03-02,Camisa,2,350",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.productsWithoutCost.length, 1);
  assert.equal(outcome.sales[0].unit_cost, outcome.sales[0].unit_price);
  assert.ok(outcome.report.warnings.some((warning) => /no traían? costo/.test(warning)));
});

test("corrige el orden cuando el costo aparece antes que el precio", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "fecha,producto,cantidad,precio unitario,costo unitario",
        "2026-03-01,Camisa,4,210,350",
        "2026-03-02,Camisa,2,210,350",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.sales[0].unit_price, 350);
  assert.equal(outcome.sales[0].unit_cost, 210);
  assert.ok(
    outcome.report.tables[0].notes.some((note) => note.includes("intercambiaron")),
  );
});

test("registra con existencia cero los productos vendidos que no están en el inventario", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "fecha,codigo,producto,cantidad,precio,costo",
        "2026-03-01,P-1,Camisa,4,350,210",
        "2026-03-01,P-9,Gorra,2,150,90",
      ].join("\n"),
    ),
    file("inventario.csv", "codigo,producto,existencia,costo\nP-1,Camisa,40,210"),
  ]);

  assert.deepEqual(outcome.productsWithoutInventory, ["P-9"]);
  const missing = outcome.inventory.find((row) => row.product_id === "P-9");
  assert.ok(missing);
  assert.equal(missing.current_stock, 0);
  assert.equal(missing.unit_cost, 90);
});

test("descarta filas de totales sin descartar el archivo completo", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "fecha,producto,cantidad,precio,costo",
        "2026-03-01,Camisa,4,350,210",
        "2026-03-02,Camisa,2,350,210",
        "TOTAL,,6,,",
      ].join("\n"),
    ),
  ]);

  assert.equal(outcome.sales.length, 2);
  assert.equal(outcome.report.tables[0].rowsDiscarded, 1);
});

test("explica el problema cuando solo se carga inventario", () => {
  assert.throws(
    () =>
      ingestFiles([
        file("inventario.csv", "codigo,producto,existencia,costo\nP-1,Camisa,40,210"),
      ]),
    (error: unknown) => {
      assert.ok(error instanceof IngestError);
      assert.match(error.message, /inventario/i);
      return true;
    },
  );
});

test("avisa cuando el archivo es un formato que no se puede leer", () => {
  assert.throws(
    () => ingestFiles([file("reporte.pdf", "%PDF-1.7\n%binario")]),
    (error: unknown) => {
      assert.ok(error instanceof IngestError);
      return true;
    },
  );
});

test("interpreta valores sueltos con distintos formatos", () => {
  assert.equal(parseNumber("L 1,234.56"), 1234.56);
  assert.equal(parseNumber("1.234,56", "eu"), 1234.56);
  assert.equal(parseNumber("(450)"), -450);
  assert.equal(parseNumber("450-"), -450);
  assert.equal(parseNumber("12%"), 0.12);
  assert.equal(parseNumber("Aceite 500g"), null);
  assert.equal(parseNumber("P-001"), null);

  assert.equal(parseDate("01/03/2026", "dmy"), "2026-03-01");
  assert.equal(parseDate("03/01/2026", "mdy"), "2026-03-01");
  assert.equal(parseDate("2026-03-01"), "2026-03-01");
  assert.equal(parseDate("20260301"), "2026-03-01");
  assert.equal(parseDate("1 de marzo de 2026"), "2026-03-01");
  assert.equal(parseDate("45717"), null);
  assert.equal(parseDate("45717", "iso", { allowSerial: true }), "2025-03-01");
});

test("cruza tres tablas relacionales: ventas, existencias y catálogo", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "id_venta,fecha,codigo_producto,producto,cantidad,precio_unitario,total,metodo_pago",
        "V-1,2026-08-01,MED-0001,Paracetamol 500 mg,4,120,480,Efectivo",
        "V-2,2026-08-02,MED-0002,Ibuprofeno 400 mg,2,165,330,Tarjeta",
        "V-3,2026-08-03,MED-0003,Amoxicilina 500 mg,3,310,930,Efectivo",
        "V-4,2026-08-04,MED-0004,Loratadina 10 mg,5,75,375,Efectivo",
        "V-5,2026-08-05,MED-0001,Paracetamol 500 mg,6,120,720,Tarjeta",
      ].join("\n"),
    ),
    file(
      "inventario.csv",
      [
        "id,id_producto,codigo_producto,cantidad,stock_minimo,lote,fecha_vencimiento",
        "1,1,MED-0001,183,13,LOT-2026-001,2027-01-26",
        "2,2,MED-0002,209,18,LOT-2026-002,2027-09-08",
        "3,3,MED-0003,77,15,LOT-2026-003,2027-04-11",
        "4,4,MED-0004,46,10,LOT-2026-004,2027-06-02",
      ].join("\n"),
    ),
    file(
      "productos.csv",
      [
        "id,codigo,nombre,categoria,presentacion,precio_compra,precio_venta",
        "1,MED-0001,Paracetamol 500 mg,Analgésico,Tabletas x 100,85,120",
        "2,MED-0002,Ibuprofeno 400 mg,Antiinflamatorio,Tabletas x 50,110,165",
        "3,MED-0003,Amoxicilina 500 mg,Antibiótico,Cápsulas x 30,220,310",
        "4,MED-0004,Loratadina 10 mg,Antialérgico,Tabletas x 20,45,75",
      ].join("\n"),
    ),
  ]);

  const roles = outcome.report.tables.map((table) => table.role);
  assert.deepEqual(roles, ["sales", "inventory", "catalog"]);

  // "cantidad" significa cosas distintas en cada archivo.
  assert.equal(outcome.sales.length, 5);
  assert.equal(outcome.sales[0].quantity, 4);
  const paracetamol = outcome.inventory.find((row) => row.product_id === "MED-0001");
  assert.ok(paracetamol);
  assert.equal(paracetamol.current_stock, 183);

  // El costo llega desde el catálogo, no desde las ventas.
  assert.equal(paracetamol.unit_cost, 85);
  assert.equal(paracetamol.unit_price, 120);
  assert.equal(paracetamol.product_name, "Paracetamol 500 mg");
  assert.equal(outcome.sales[0].unit_cost, 85);

  assert.equal(outcome.report.catalogProducts, 4);
  assert.equal(outcome.report.productsMatched, 4);
  assert.equal(outcome.productsWithoutCost.length, 0);
  assert.equal(outcome.productsWithoutInventory.length, 0);
});

test("no confunde el correlativo de la base de datos con el código del producto", () => {
  const outcome = ingestFiles([
    file(
      "ventas.csv",
      [
        "id,id_producto,codigo_producto,producto,fecha,cantidad,precio",
        "1,7,SKU-A,Camisa,2026-08-01,2,350",
        "2,8,SKU-B,Pantalón,2026-08-02,1,720",
        "3,7,SKU-A,Camisa,2026-08-03,4,350",
        "4,9,SKU-C,Gorra,2026-08-04,3,150",
      ].join("\n"),
    ),
  ]);

  const codes = outcome.sales.map((sale) => sale.product_id);
  assert.deepEqual(codes, ["SKU-A", "SKU-B", "SKU-A", "SKU-C"]);
});

test("no toma una fecha de vencimiento como fecha de venta", () => {
  const outcome = ingestFiles([
    file(
      "existencias.csv",
      [
        "codigo,producto,cantidad,stock_minimo,fecha_vencimiento",
        "MED-1,Paracetamol,183,13,2027-01-26",
        "MED-2,Ibuprofeno,209,18,2027-09-08",
        "MED-3,Amoxicilina,77,15,2027-04-11",
        "MED-4,Loratadina,46,10,2027-06-02",
      ].join("\n"),
    ),
    file("ventas.csv", "fecha,codigo,cantidad,precio\n2026-08-01,MED-1,4,120"),
  ]);

  const inventory = outcome.report.tables.find((table) => table.source === "existencias.csv");
  assert.ok(inventory);
  assert.equal(inventory.role, "inventory");
  assert.equal(outcome.report.salesRows, 1);
  assert.equal(outcome.inventory.find((row) => row.product_id === "MED-1")?.current_stock, 183);
});

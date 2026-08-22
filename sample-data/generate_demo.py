"""Genera los datos de ejemplo del MVP.

Además del formato canónico (sales.csv e inventory.csv), escribe versiones
"sucias" equivalentes a lo que exporta un sistema administrativo real, para
probar la lectura automática de archivos: punto y coma, fechas dd/mm/aaaa,
montos con símbolo de moneda, encabezados en español, JSON y Excel.

También escribe una versión con la convención de nombres de a2 (prefijos de
tipo, descripciones abreviadas y columna de tipo de documento).
"""

from __future__ import annotations

import csv
import json
import zipfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
START = date(2025, 12, 1)
END = date(2026, 7, 31)

PRODUCTS = {
    "P-001": ("Producto rentable", 180, 95),
    "P-002": ("Producto sobreabastecido", 250, 170),
    "P-003": ("Producto con margen bajo", 105, 100),
    "P-004": ("Producto por agotarse", 160, 105),
    "P-006": ("Producto estacional detenido", 210, 140),
}

INVENTORY = [
    ("P-001", "Producto rentable", 80, 95, 12),
    ("P-002", "Producto sobreabastecido", 220, 170, 8),
    ("P-003", "Producto con margen bajo", 300, 100, 10),
    ("P-004", "Producto por agotarse", 20, 105, 15),
    ("P-005", "Producto descontinuado", 140, 88, 10),
    ("P-006", "Producto estacional detenido", 95, 140, 20),
]


def quantity(product_id: str, current: date, day_index: int) -> int:
    weekday = current.weekday()
    day = current.day

    if product_id == "P-001":
        trend = day_index // 70
        weekly = [4, 5, 5, 6, 8, 3, 2][weekday]
        promotion = 7 if day in {5, 20} else 0
        return weekly + trend + promotion

    if product_id == "P-002":
        return 2 if day in {1, 15} else (1 if day_index % 13 == 0 else 0)

    if product_id == "P-003":
        weekly = [8, 8, 7, 7, 9, 5, 4][weekday]
        return weekly + (2 if day in {10, 25} else 0)

    if product_id == "P-004":
        trend = day_index // 35
        weekly = [5, 6, 7, 8, 10, 8, 6][weekday]
        campaign = 10 if 12 <= day <= 14 else 0
        return weekly + trend + campaign

    if product_id == "P-006":
        # Temporada que terminó: deja de venderse a los tres meses.
        if day_index > 92:
            return 0
        return [3, 4, 4, 5, 6, 2, 1][weekday]

    return 0


def build_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    current = START
    sale_number = 1

    while current <= END:
        day_index = (current - START).days
        for product_id, (name, price, cost) in PRODUCTS.items():
            units = quantity(product_id, current, day_index)
            if units <= 0:
                continue
            rows.append(
                {
                    "sale_id": f"V-{sale_number:05d}",
                    "sale_date": current.isoformat(),
                    "product_id": product_id,
                    "product_name": name,
                    "quantity": units,
                    "unit_price": price,
                    "unit_cost": cost,
                    "customer_id": f"C-{(sale_number % 18) + 1:02d}",
                }
            )
            sale_number += 1
        current += timedelta(days=1)

    return rows


def write_canonical(rows: list[dict[str, object]]) -> None:
    with (ROOT / "sales.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    with (ROOT / "inventory.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(
            ["product_id", "product_name", "current_stock", "unit_cost", "lead_time_days"]
        )
        writer.writerows(INVENTORY)


def write_messy_sales(rows: list[dict[str, object]]) -> None:
    """Exportación típica: membrete, punto y coma, dd/mm/aaaa y montos con L."""
    lines = [
        "REPORTE DE VENTAS POR ARTICULO",
        "Empresa demostracion S. de R.L.;;Emitido por el sistema",
        "",
        "FECHAEMISION;COD_ARTICULO;DESCRIPCION;CANT;PRECIO_UNIT;COSTO_UNIT;CLIENTE",
    ]

    for row in rows:
        sale_date = date.fromisoformat(str(row["sale_date"]))
        lines.append(
            ";".join(
                [
                    sale_date.strftime("%d/%m/%Y"),
                    str(row["product_id"]),
                    str(row["product_name"]),
                    str(row["quantity"]),
                    f"L {float(row['unit_price']):,.2f}",
                    f"L {float(row['unit_cost']):,.2f}",
                    str(row["customer_id"]),
                ]
            )
        )

    (ROOT / "ventas_sistema.csv").write_text(
        "\n".join(lines), encoding="cp1252", newline="\n"
    )


def write_inventory_json() -> None:
    data = {
        "inventario": [
            {
                "codigo": product_id,
                "descripcion": name,
                "existencia": stock,
                "costo promedio": cost,
                "dias de reposicion": lead_time,
            }
            for product_id, name, stock, cost, lead_time in INVENTORY
        ]
    }
    (ROOT / "inventario_sistema.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _xml_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_inventory_xlsx() -> None:
    """Escribe un .xlsx mínimo (sin dependencias) con la hoja de existencias."""
    header = ["Codigo", "Producto", "Existencia", "Costo", "Dias de reposicion"]
    table: list[list[object]] = [header]
    table.extend([product_id, name, stock, cost, lead] for product_id, name, stock, cost, lead in INVENTORY)

    def column_letter(index: int) -> str:
        letters = ""
        while index >= 0:
            letters = chr(index % 26 + 65) + letters
            index = index // 26 - 1
        return letters

    rows_xml: list[str] = []
    for row_index, row in enumerate(table, start=1):
        cells: list[str] = []
        for column_index, value in enumerate(row):
            reference = f"{column_letter(column_index)}{row_index}"
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{reference}"><v>{value}</v></c>')
            else:
                cells.append(
                    f'<c r="{reference}" t="inlineStr"><is><t>{_xml_escape(str(value))}</t></is></c>'
                )
        rows_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(rows_xml)}</sheetData></worksheet>'
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Existencias" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )

    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )

    with zipfile.ZipFile(ROOT / "inventario_sistema.xlsx", "w", zipfile.ZIP_DEFLATED) as book:
        book.writestr("[Content_Types].xml", content_types)
        book.writestr("_rels/.rels", root_rels)
        book.writestr("xl/workbook.xml", workbook)
        book.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        book.writestr("xl/worksheets/sheet1.xml", sheet)


def _a2_number(value: float) -> str:
    """Miles con punto y decimales con coma, como sale de un a2 en espanol."""
    text = f"{value:,.2f}"
    return text.replace(",", "|").replace(".", ",").replace("|", ".")


def write_a2_sales(rows: list[dict[str, object]]) -> None:
    """Renglones de factura con la convención de nombres de a2.

    Los campos llevan el prefijo de tipo de la base de datos (c_, n_, d_), la
    descripción viene abreviada como `c_Descri` y el tipo de documento distingue
    facturas, notas de crédito y presupuestos.
    """
    lines = [
        "c_TipoDoc;c_NumeroD;d_Fecha;c_CodClie;c_CodArt;c_Descri;n_Cantidad;n_Precio;n_CostoAct"
    ]

    for index, row in enumerate(rows):
        sale_date = date.fromisoformat(str(row["sale_date"]))

        # Una de cada 60 líneas se devuelve, y una de cada 97 quedó en
        # presupuesto: ninguna de las dos es una venta cobrada.
        if index % 97 == 0:
            document = "PRE"
        elif index % 60 == 0:
            document = "N/C"
        else:
            document = "FAC"

        lines.append(
            ";".join(
                [
                    document,
                    f"{index + 1:06d}",
                    sale_date.strftime("%d/%m/%Y"),
                    str(row["customer_id"]),
                    str(row["product_id"]),
                    str(row["product_name"]).upper(),
                    str(row["quantity"]),
                    _a2_number(float(row["unit_price"])),
                    _a2_number(float(row["unit_cost"])),
                ]
            )
        )

    (ROOT / "a2_ventas.csv").write_text(
        "\n".join(lines), encoding="cp1252", newline="\n"
    )


def write_a2_inventory() -> None:
    """Maestro de artículos con existencia, en la misma convención."""
    lines = ["c_CodArt;c_Descri;n_Existen;n_CostoAct;n_Precio1;c_Deposito;n_DiasRep"]

    for product_id, name, stock, cost, lead_time in INVENTORY:
        price = next(
            (info[1] for code, info in PRODUCTS.items() if code == product_id),
            round(cost * 1.35, 2),
        )
        lines.append(
            ";".join(
                [
                    product_id,
                    name.upper(),
                    str(stock),
                    _a2_number(float(cost)),
                    _a2_number(float(price)),
                    "PRINCIPAL",
                    str(lead_time),
                ]
            )
        )

    (ROOT / "a2_inventario.csv").write_text(
        "\n".join(lines), encoding="cp1252", newline="\n"
    )


def write_a2_movements(rows: list[dict[str, object]]) -> None:
    """Movimientos de almacén: entradas por compra y salidas por venta."""
    lines = ["d_Fecha;c_Tipo;c_CodArt;c_Descri;n_Cantidad;n_Costo;c_Deposito"]

    for index, row in enumerate(rows):
        sale_date = date.fromisoformat(str(row["sale_date"]))
        lines.append(
            ";".join(
                [
                    sale_date.strftime("%d/%m/%Y"),
                    "S",
                    str(row["product_id"]),
                    str(row["product_name"]).upper(),
                    str(row["quantity"]),
                    _a2_number(float(row["unit_cost"])),
                    "PRINCIPAL",
                ]
            )
        )

        # Reposiciones del proveedor cada tanto: entran al almacén, no son venta.
        if index % 45 == 0:
            lines.append(
                ";".join(
                    [
                        sale_date.strftime("%d/%m/%Y"),
                        "E",
                        str(row["product_id"]),
                        str(row["product_name"]).upper(),
                        "50",
                        _a2_number(float(row["unit_cost"])),
                        "PRINCIPAL",
                    ]
                )
            )

    (ROOT / "a2_movimientos.csv").write_text(
        "\n".join(lines), encoding="cp1252", newline="\n"
    )


if __name__ == "__main__":
    generated = build_rows()
    write_canonical(generated)
    write_messy_sales(generated)
    write_inventory_json()
    write_inventory_xlsx()
    write_a2_sales(generated)
    write_a2_inventory()
    write_a2_movements(generated)
    print(f"Generadas {len(generated)} filas desde {START} hasta {END}.")
    print(
        "Archivos: sales.csv, inventory.csv, ventas_sistema.csv, "
        "inventario_sistema.json, inventario_sistema.xlsx, "
        "a2_ventas.csv, a2_inventario.csv, a2_movimientos.csv"
    )

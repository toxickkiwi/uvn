"""Превращает стартовую таблицу .xlsx в JSON для локального симулятора (dev/gas-sim.js).

    python3 dev/xlsx_to_json.py CRM_стартовая_таблица.xlsx dev/fixtures/start.json

Даты из Excel считаются московским временем.
"""
import datetime
import json
import sys

import openpyxl


def cell(v):
    if isinstance(v, datetime.datetime):
        return {"$date": v.strftime("%Y-%m-%dT%H:%M:%S") + "+03:00"}
    if isinstance(v, datetime.time):
        return {"$date": "1899-12-30T" + v.strftime("%H:%M:%S") + "+03:00"}
    return "" if v is None else v


wb = openpyxl.load_workbook(sys.argv[1])
out = {}
for ws in wb.worksheets:
    rows = [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]
    while rows and all(c == "" for c in rows[-1]):
        rows.pop()
    out[ws.title] = rows
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("листов:", len(out))

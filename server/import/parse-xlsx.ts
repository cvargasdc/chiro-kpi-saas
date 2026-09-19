import * as XLSX from "xlsx";
import { IMPORT_MAX_CELL, IMPORT_MAX_COLUMNS, type ParsedSheet } from "@shared/import";

/**
 * SheetJS (xlsx) parse. Generic workbook only — no EHR-specific layout.
 */
export function parseXlsxBuffer(buffer: Buffer): ParsedSheet {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (aoa.length === 0) return { headers: [], rows: [] };
  const headerRow = (aoa[0] ?? []).map((cell, idx) => {
    const text = String(cell ?? "").trim();
    return text.length > 0 ? text : `Column ${idx + 1}`;
  });
  const headers = headerRow.slice(0, IMPORT_MAX_COLUMNS);
  const rows = aoa.slice(1).map((raw) => {
    const line = Array.isArray(raw) ? raw : [];
    const padded: string[] = [];
    for (let i = 0; i < headers.length; i += 1) {
      padded.push(String(line[i] ?? "").slice(0, IMPORT_MAX_CELL));
    }
    return padded;
  });
  return { headers, rows };
}

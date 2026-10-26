import ExcelJS from "exceljs";
import { ImportError, type Sheets } from "../shared/importers";

/** Reads every sheet into rows of display text (rich text and formulas flattened). */
export async function readWorkbook(buf: Buffer): Promise<Sheets> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new ImportError("无法读取 Excel 文件：请上传映言导出的 .xlsx");
  }
  const sheets: Sheets = {};
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => (cells[c - 1] = cell.text ?? ""));
      rows[n - 1] = Array.from(cells, (c) => c ?? "");
    });
    sheets[ws.name] = Array.from(rows, (r) => r ?? []);
  });
  return sheets;
}

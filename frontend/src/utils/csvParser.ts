/**
 * Parse CSV / TSV text with support for quoted cells, escaped quotes (""), and varied line breaks.
 */
export function parseCsvTsv(text: string, delimiter?: string): string[][] {
  let sep = delimiter;
  if (!sep) {
    const firstLine = text.split('\n')[0] || '';
    sep = firstLine.includes('\t') ? '\t' : ',';
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        currentCell += '"';
        i++; // skip next escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') {
          i++; // handle CRLF
        }
        currentRow.push(currentCell.trim());
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  // Filter out completely empty rows
  return rows.filter((row) => row.some((val) => val !== ''));
}

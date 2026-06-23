// Tiny RFC 4180 CSV parse + stringify. NO new deps — the incumbent exports
// (乗りつぶしオンライン / RailLab) are small CSVs and our own T10 export is plain CSV,
// so a hand-rolled, well-tested parser beats pulling in a dependency.
//
// Coverage of RFC 4180 we care about:
//  • comma field separator; CRLF or LF or CR row terminators
//  • double-quoted fields may contain commas, embedded newlines, and "" escaped quotes
//  • a trailing newline does NOT create a spurious empty trailing row
//  • a leading UTF-8 BOM (very common in Windows-authored incumbent CSVs) is stripped

/** Parse a CSV string into a matrix of string cells (no header interpretation). */
export function parseCsv(input: string): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false; // did this row see content (so a final empty line is dropped)

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (c === ',') {
      pushField();
      sawAnyChar = true;
    } else if (c === '\r') {
      // handle CRLF as one terminator
      if (text[i + 1] === '\n') i++;
      pushRow();
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
      sawAnyChar = true;
    }
  }

  // Flush the last field/row unless the input ended exactly on a row terminator with
  // no trailing content (avoids a phantom empty final row from a trailing newline).
  if (sawAnyChar || field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

/** A cell needs quoting if it contains a comma, quote, or newline. */
function needsQuoting(cell: string): boolean {
  return /[",\r\n]/.test(cell);
}

function escapeCell(cell: string): string {
  if (!needsQuoting(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

/** Stringify a matrix of cells into an RFC 4180 CSV (CRLF terminators per spec). */
export function stringifyCsv(rows: (string | number | undefined | null)[][]): string {
  return rows
    .map((row) => row.map((c) => escapeCell(c == null ? '' : String(c))).join(','))
    .join('\r\n');
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

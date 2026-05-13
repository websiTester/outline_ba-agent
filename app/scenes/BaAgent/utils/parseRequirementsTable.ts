export type RequirementRow = {
  id: string;
  type: "FR" | "NFR";
  name: string;
  description: string;
  rationale: string;
  reference: string;
};

export type ParseResult = {
  frItems: RequirementRow[];
  nfrItems: RequirementRow[];
  headerRow: string;
  separatorRow: string;
};

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Splits a pipe-delimited markdown table row into trimmed cell values.
 * Leading/trailing pipes are ignored.
 */
function splitTableRow(row: string): string[] {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/**
 * Parses the markdown requirements table in document 2.2 and splits rows
 * into FR and NFR buckets. Throws ParseError if no valid table is found.
 */
export function parseRequirementsTable(markdown: string): ParseResult {
  const lines = markdown.split("\n").map((l) => l.trimEnd());

  // Find header row index — must contain all expected columns
  const requiredColumns = ["ID", "Type", "Name", "Description"];
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith("|")) return false;
    const cells = splitTableRow(line);
    return requiredColumns.every((col) =>
      cells.some((c) => c.toLowerCase() === col.toLowerCase())
    );
  });

  if (headerIndex === -1) {
    throw new ParseError(
      "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung"
    );
  }

  const separatorIndex = headerIndex + 1;
  const separator = lines[separatorIndex] ?? "";

  // Validate separator row (must look like |---|---|)
  if (!separator.startsWith("|") || !separator.includes("---")) {
    throw new ParseError(
      "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung"
    );
  }

  const headerCells = splitTableRow(lines[headerIndex]).map((c) =>
    c.toLowerCase()
  );
  const idIdx = headerCells.indexOf("id");
  const typeIdx = headerCells.indexOf("type");
  const nameIdx = headerCells.indexOf("name");
  const descIdx = headerCells.indexOf("description");
  const rationaleIdx = headerCells.indexOf("rationale");
  const referenceIdx = headerCells.indexOf("reference");

  if (idIdx === -1 || typeIdx === -1 || nameIdx === -1 || descIdx === -1) {
    throw new ParseError(
      "Không thể đọc dữ liệu từ document, vui lòng kiểm tra lại nội dung"
    );
  }

  const frItems: RequirementRow[] = [];
  const nfrItems: RequirementRow[] = [];

  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith("|")) break;

    const cells = splitTableRow(line);
    const type = cells[typeIdx]?.toUpperCase();
    if (type !== "FR" && type !== "NFR") continue;

    const row: RequirementRow = {
      id: cells[idIdx] ?? "",
      type,
      name: cells[nameIdx] ?? "",
      description: cells[descIdx] ?? "",
      rationale: rationaleIdx !== -1 ? (cells[rationaleIdx] ?? "") : "",
      reference: referenceIdx !== -1 ? (cells[referenceIdx] ?? "") : "",
    };

    if (type === "FR") {
      frItems.push(row);
    } else {
      nfrItems.push(row);
    }
  }

  return {
    frItems,
    nfrItems,
    headerRow: lines[headerIndex],
    separatorRow: separator,
  };
}

/**
 * Formats a single FR row into a structured markdown document.
 *
 * Example output:
 * # FR-01: Đăng ký tài khoản
 *
 * **ID:** FR-01
 * **Type:** FR
 * **Description:** ...
 * **Rationale:** ...
 * **Reference:** ...
 */
export function formatFrDocumentContent(row: RequirementRow): string {
  const lines = [
    `# ${row.id}: ${row.name}`,
    "",
    `**ID:** ${row.id}`,
    `**Type:** ${row.type}`,
    `**Description:** ${row.description}`,
  ];

  if (row.rationale) {
    lines.push(`**Rationale:** ${row.rationale}`);
  }
  if (row.reference) {
    lines.push(`**Reference:** ${row.reference}`);
  }

  return lines.join("\n");
}

/**
 * Reconstructs a markdown table containing only NFR rows.
 * If nfrItems is empty the result is a table with only the header (no data rows).
 */
export function formatNfrTableContent(
  nfrItems: RequirementRow[],
  headerRow: string,
  separatorRow: string
): string {
  if (nfrItems.length === 0) {
    return [headerRow, separatorRow].join("\n");
  }

  const dataRows = nfrItems.map(
    (row) =>
      `| ${row.id} | ${row.type} | ${row.name} | ${row.description} | ${row.rationale} | ${row.reference} |`
  );

  return [headerRow, separatorRow, ...dataRows].join("\n");
}

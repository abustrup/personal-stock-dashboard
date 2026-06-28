import type { AssetType, Holding } from "./types";

export type PortfolioParseResult = {
  holdings: Holding[];
  skippedRows: number;
  totalMarketValueDkk: number;
};

type CsvRow = Record<string, string>;

const exchangeSuffix: Record<string, string> = {
  xnas: "",
  xnys: "",
  arcx: "",
  xase: "",
  xcse: ".CO",
  xetr: ".DE",
  xfra: ".F",
  xlon: ".L",
  xams: ".AS",
  xpar: ".PA",
  xsto: ".ST",
  xhkg: ".HK",
  xtks: ".T",
  xkrx: ".KS",
  xtai: ".TW",
  xshg: ".SS",
  xshe: ".SZ",
};

export function providerSymbol(rawSymbol: string): string {
  const [ticker, exchange] = rawSymbol.trim().split(":");
  if (!ticker) return "";
  const suffix = exchange ? exchangeSuffix[exchange.toLowerCase()] ?? "" : "";
  return `${ticker}${suffix}`;
}

export function parsePortfolioCsv(input: string): PortfolioParseResult {
  const rows = parseCsv(input);
  const holdings = rows
    .filter((row) => hasPositionIdentity(row))
    .map(toHolding);

  return {
    holdings,
    skippedRows: rows.length - holdings.length,
    totalMarketValueDkk: holdings.reduce((sum, holding) => sum + holding.marketValueDkk, 0),
  };
}

function hasPositionIdentity(row: CsvRow): boolean {
  return Boolean(value(row, "Symbol") && value(row, "ISIN"));
}

function toHolding(row: CsvRow): Holding {
  const rawSymbol = value(row, "Symbol");
  const [symbol, exchangeCode] = rawSymbol.split(":");

  return {
    instrument: value(row, "Instrument"),
    rawSymbol,
    symbol: symbol.trim(),
    exchangeCode: exchangeCode?.trim().toLowerCase(),
    providerSymbol: providerSymbol(rawSymbol),
    isin: value(row, "ISIN"),
    issuer: value(row, "Udsteder"),
    assetType: mapAssetType(value(row, "Aktivtype")),
    currency: value(row, "Valuta"),
    quantity: parseDanishNumber(value(row, "Antal")),
    currentPrice: parseDanishNumber(value(row, "Aktuel kurs")),
    costPrice: optionalNumber(value(row, "Kostpris")),
    openingPrice: optionalNumber(value(row, "Åbningskurs")),
    marketValueDkk: parseDanishNumber(value(row, "Markedsværdi (DKK)")),
    costBasisDkk: optionalNumber(value(row, "Oprindelig værdi (DKK)")),
    totalGainDkk: optionalNumber(value(row, "Gevinst/Tab i alt (DKK)")),
    totalReturnPct: optionalNumber(value(row, "% Total afkast")),
    dayReturnPct: optionalNumber(value(row, "% 1D afk.")),
    dayGainDkk: optionalNumber(value(row, "1-dags gevinst/tab (DKK)")),
    // Source stores weight as a fraction (0.1179); surface it as a percent (11.79).
    portfolioWeight: parseDanishNumber(value(row, "% af portefølje")) * 100,
    lastUpdated: value(row, "Senest opdateret") || undefined,
  };
}

function value(row: CsvRow, key: string): string {
  return (row[key] ?? "").trim();
}

function optionalNumber(raw: string): number | undefined {
  const parsed = parseDanishNumber(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapAssetType(raw: string): AssetType {
  const normalized = raw.toLowerCase();
  if (normalized.includes("aktie")) return "stock";
  if (normalized.includes("etf")) return "etf";
  return "unknown";
}

export function parseDanishNumber(raw: string): number {
  const cleaned = raw
    .replace(/\u00a0/g, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

function parseCsv(input: string): CsvRow[] {
  const records = parseCsvRecords(input.replace(/^\ufeff/, ""));
  const [headers, ...rows] = records;
  if (!headers) return [];

  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) =>
      headers.reduce<CsvRow>((result, header, index) => {
        if (header) result[header] = row[index] ?? "";
        return result;
      }, {}),
    );
}

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      field += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      record.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || record.length) {
    record.push(field);
    records.push(record);
  }

  return records;
}

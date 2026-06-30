import { describe, expect, it } from "vitest";
import { COMPANY_DIRECTORY, searchDirectory } from "./companyDirectory";

describe("searchDirectory", () => {
  it("returns nothing for an empty or whitespace query (dropdown stays closed)", () => {
    expect(searchDirectory("")).toEqual([]);
    expect(searchDirectory("   ")).toEqual([]);
  });

  it("matches a company by the name the user types, case-insensitively", () => {
    expect(searchDirectory("novo nord")[0]?.symbol).toBe("NOVO-B.CO");
    expect(searchDirectory("ORACLE")[0]?.symbol).toBe("ORCL");
  });

  it("matches an alias the user is likelier to type than the legal name", () => {
    expect(searchDirectory("novo")[0]?.symbol).toBe("NOVO-B.CO");
    expect(searchDirectory("besi")[0]?.symbol).toBe("BESI.AS");
    expect(searchDirectory("infineon")[0]?.symbol).toBe("IFX.DE");
  });

  it("ranks an exact ticker above a name that merely contains the query", () => {
    expect(searchDirectory("mu")[0]?.symbol).toBe("MU"); // exact ticker (Micron) leads
  });

  it("ranks a symbol prefix above a substring-in-name match", () => {
    // "nov" is a symbol prefix of NOVO-B.CO and a name prefix of "Novo Nordisk".
    expect(searchDirectory("nov")[0]?.symbol).toBe("NOVO-B.CO");
  });

  it("excludes symbols already owned/in-universe/watched before applying the limit", () => {
    const all = searchDirectory("s", { limit: 50 });
    const exclude = new Set([all[0].symbol.toUpperCase()]);
    const filtered = searchDirectory("s", { limit: 50, exclude });
    expect(filtered.some((entry) => entry.symbol === all[0].symbol)).toBe(false);
  });

  it("honours the result limit", () => {
    expect(searchDirectory("s", { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it("is deterministic and breaks ties within a score tier alphabetically", () => {
    const a = searchDirectory("s", { limit: 50 });
    const b = searchDirectory("s", { limit: 50 });
    expect(a).toEqual(b); // stable keystroke to keystroke

    // Names that match only as a same-strength name-prefix (their symbols do NOT
    // start with "s", so no stronger symbol-prefix hit) come out alphabetical.
    const nameTier = ["Salesforce", "ServiceNow"];
    const order = a.filter((e) => nameTier.includes(e.name)).map((e) => e.name);
    expect(order).toEqual(nameTier);
  });
});

describe("COMPANY_DIRECTORY integrity", () => {
  it("has unique symbols", () => {
    const symbols = COMPANY_DIRECTORY.map((entry) => entry.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("every entry carries identity only: name, Yahoo-style symbol, exchange", () => {
    for (const entry of COMPANY_DIRECTORY) {
      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.symbol.trim().length).toBeGreaterThan(0);
      expect(entry.exchange.trim().length).toBeGreaterThan(0);
      // No price/score leaks into the directory — it must stay identity-only.
      expect(entry).not.toHaveProperty("price");
      expect(entry).not.toHaveProperty("score");
    }
  });

  it("spans markets a Danish owner can usefully reach (incl. non-US listings)", () => {
    const exchanges = new Set(COMPANY_DIRECTORY.map((entry) => entry.exchange));
    expect(exchanges.has("Nasdaq Copenhagen")).toBe(true); // local names (Novo, Vestas…)
    expect(exchanges.has("XETRA")).toBe(true); // European semis (Infineon, SAP)
    expect([...exchanges].length).toBeGreaterThan(2);
  });
});

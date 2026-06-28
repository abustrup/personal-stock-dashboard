import { describe, expect, it } from "vitest";
import { evaluateCompliance } from "./compliance";

describe("evaluateCompliance", () => {
  it("hard blocks permanent negative list companies from the EIFO policy", () => {
    const result = evaluateCompliance({
      name: "Vestas Wind Systems A/S",
      symbol: "VWS.CO",
      isin: "DK0061539921",
      themes: ["clean-tech"],
    });

    expect(result.status).toBe("blocked");
    expect(result.flags[0]).toContain("Permanent negative list");
  });

  it("flags possible EIFO overlap on mandate themes without claiming clean status", () => {
    const result = evaluateCompliance({
      name: "Anduril Industries",
      symbol: "PRIVATE:ANDURIL",
      themes: ["defence", "dual-use-ai"],
    });

    expect(result.status).toBe("possible_overlap");
    expect(result.flags.join(" ")).toMatch(/possible eifo overlap/i);
  });

  it("flags Danish/Nordic domicile as possible overlap regardless of theme", () => {
    const result = evaluateCompliance({
      name: "Some Danish Exporter A/S",
      symbol: "DANEX.CO",
      region: "Denmark",
      themes: ["logistics"],
    });

    expect(result.status).toBe("possible_overlap");
    expect(result.flags.join(" ")).toMatch(/core market/i);
  });

  it("returns unknown rather than clean for a foreign mega-cap with no mandate overlap", () => {
    const result = evaluateCompliance({
      name: "NVIDIA Corp.",
      symbol: "NVDA",
      region: "US",
      themes: ["ai-infrastructure"],
    });

    expect(result.status).toBe("unknown");
    expect(result.flags.join(" ")).toContain("cannot be called clean");
  });

  it("hard blocks a company the user marked as an EIFO investment (§9.1)", () => {
    const result = evaluateCompliance(
      { name: "Ørsted A/S", symbol: "ORSTED.CO", region: "Denmark", themes: [] },
      { "ORSTED.CO": "investment" },
    );

    expect(result.status).toBe("blocked");
    expect(result.flags.join(" ")).toContain("§9.1");
  });

  it("marks an EIFO loan/guarantee company as restricted with the 6-month note (§9.2)", () => {
    const result = evaluateCompliance(
      { name: "A.P. Moller - Maersk", symbol: "MAERSK-B.CO", themes: ["shipping"] },
      { maersk: "loan_or_guarantee" },
    );

    expect(result.status).toBe("restricted");
    expect(result.notes?.join(" ")).toMatch(/6 months/i);
    expect(result.notes?.join(" ")).toMatch(/derivative/i);
  });
});

import { describe, expect, it } from "vitest";
import { parseBrokerSettings, serializeBrokerSettings } from "./brokerSettings";
import { DEFAULT_BROKER_SETTINGS } from "./investability";

describe("broker settings storage", () => {
  it("round-trips a full settings object", () => {
    const json = serializeBrokerSettings({ perTradeBudgetDkk: 8000, untradableExchanges: ["Korea Exchange", "Hong Kong"] });
    const parsed = parseBrokerSettings(json);
    expect(parsed.perTradeBudgetDkk).toBe(8000);
    expect(parsed.untradableExchanges).toEqual(["Korea Exchange", "Hong Kong"]);
  });

  it("falls back to defaults for missing or empty input", () => {
    expect(parseBrokerSettings(undefined)).toEqual(DEFAULT_BROKER_SETTINGS);
    expect(parseBrokerSettings("")).toEqual(DEFAULT_BROKER_SETTINGS);
    expect(parseBrokerSettings("not json")).toEqual(DEFAULT_BROKER_SETTINGS);
  });

  it("repairs a partial payload onto the defaults", () => {
    // Only a budget stored — exchanges should fall back, not vanish.
    const parsed = parseBrokerSettings(JSON.stringify({ version: 1, perTradeBudgetDkk: 12000 }));
    expect(parsed.perTradeBudgetDkk).toBe(12000);
    expect(parsed.untradableExchanges).toEqual(DEFAULT_BROKER_SETTINGS.untradableExchanges);
  });

  it("rejects a non-positive or non-numeric budget", () => {
    expect(parseBrokerSettings(JSON.stringify({ perTradeBudgetDkk: 0 })).perTradeBudgetDkk).toBe(
      DEFAULT_BROKER_SETTINGS.perTradeBudgetDkk,
    );
    expect(parseBrokerSettings(JSON.stringify({ perTradeBudgetDkk: "lots" })).perTradeBudgetDkk).toBe(
      DEFAULT_BROKER_SETTINGS.perTradeBudgetDkk,
    );
  });

  it("de-duplicates and filters the untradable exchange list", () => {
    const parsed = parseBrokerSettings(
      JSON.stringify({ untradableExchanges: ["Korea Exchange", "Korea Exchange", 5, "Hong Kong"] }),
    );
    expect(parsed.untradableExchanges).toEqual(["Korea Exchange", "Hong Kong"]);
  });
});

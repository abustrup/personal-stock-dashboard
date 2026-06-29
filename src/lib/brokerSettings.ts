import { DEFAULT_BROKER_SETTINGS, type BrokerSettings } from "./investability";

const KEY = "psd.broker.v1";

// Pure (de)serialization so it can be unit-tested without a browser. A stored
// payload is merged onto the defaults, so a partial or older blob still yields a
// complete, valid settings object rather than breaking the dashboard.
export function serializeBrokerSettings(settings: BrokerSettings): string {
  return JSON.stringify({ version: 1, ...settings });
}

export function parseBrokerSettings(raw: string | null | undefined): BrokerSettings {
  if (!raw) return DEFAULT_BROKER_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<BrokerSettings> & { version?: number };
    const budget =
      typeof parsed.perTradeBudgetDkk === "number" && Number.isFinite(parsed.perTradeBudgetDkk) && parsed.perTradeBudgetDkk > 0
        ? parsed.perTradeBudgetDkk
        : DEFAULT_BROKER_SETTINGS.perTradeBudgetDkk;
    const exchanges = Array.isArray(parsed.untradableExchanges)
      ? [...new Set(parsed.untradableExchanges.filter((value): value is string => typeof value === "string"))]
      : DEFAULT_BROKER_SETTINGS.untradableExchanges;
    return { perTradeBudgetDkk: budget, untradableExchanges: exchanges };
  } catch {
    return DEFAULT_BROKER_SETTINGS;
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined; // localStorage can throw in private mode
  }
}

export function loadBrokerSettings(): BrokerSettings {
  return parseBrokerSettings(storage()?.getItem(KEY) ?? undefined);
}

export function saveBrokerSettings(settings: BrokerSettings): void {
  try {
    storage()?.setItem(KEY, serializeBrokerSettings(settings));
  } catch {
    /* quota / private mode — non-fatal, the session keeps the in-memory settings */
  }
}

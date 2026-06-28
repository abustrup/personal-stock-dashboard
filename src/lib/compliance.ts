import type { Company, ComplianceResult } from "./types";

type ComplianceInput = Pick<Company, "name" | "symbol" | "themes"> & {
  isin?: string;
  region?: string;
};

const policySource = "EIFO policy PDF, November 2024, user-provided file only";

// §9.3 — den permanente negativliste. Verified against the policy text.
const permanentNegativeList = [
  { name: "FLSmidth A/S", matchers: ["flsmidth", "fls.co"] },
  { name: "NKT A/S", matchers: ["nkt a/s", "nkt.co"] },
  { name: "Per Aarsleff Holding A/S", matchers: ["per aarsleff", "aarsleff", "paal-b.co"] },
  { name: "Siemens Energy AG", matchers: ["siemens energy", "enr.de"] },
  { name: "Vestas Wind Systems A/S", matchers: ["vestas", "vws.co"] },
];

// Themes/regions that plausibly sit inside EIFO's actual mandate (Danish export,
// green transition, defence/security, deep tech). A soft "check the list" nudge,
// not a claim. EIFO backs mostly Danish/Nordic names, so a US/Asian mega-cap is
// unlikely to be a direct portfolio company.
const eifoMandateThemes = new Set([
  "defence",
  "dual-use-ai",
  "aerospace",
  "space",
  "export-finance",
  "clean-tech",
  "green-energy",
  "energy-infrastructure",
  "shipping",
  "industrial-decarbonization",
  "life-science",
  "quantum",
]);
const eifoRegions = new Set(["denmark", "danmark", "nordic", "norden"]);

// §9.2 reminders that apply to any company EIFO has lent to or guaranteed.
const loanRestrictionNotes = [
  "EIFO loan/guarantee: cannot sell within 6 months of acquisition (FIL §77).",
  "No speculative derivatives (options/swaps) on this name.",
];

/**
 * Manual insider-knowledge overrides. The app cannot see EIFO's monthly
 * investment or loan lists, so the user records what they personally know here:
 *  - "investment"        → §9.1 hard ban on trading.
 *  - "loan_or_guarantee" → §9.2 tradeable, but 6-month hold + no derivatives.
 * Keyed by ticker symbol or a lowercased substring of the company name.
 */
export type EifoOverride = "investment" | "loan_or_guarantee";
export type ComplianceOverrides = Record<string, EifoOverride>;

function matchOverride(company: ComplianceInput, overrides: ComplianceOverrides): EifoOverride | undefined {
  const symbol = company.symbol.toLowerCase();
  const name = company.name.toLowerCase();
  for (const [key, kind] of Object.entries(overrides)) {
    const needle = key.toLowerCase();
    if (symbol === needle || name.includes(needle)) return kind;
  }
  return undefined;
}

export function evaluateCompliance(
  company: ComplianceInput,
  overrides: ComplianceOverrides = {},
): ComplianceResult {
  const normalizedName = company.name.toLowerCase();
  const normalizedSymbol = company.symbol.toLowerCase();

  const blocked = permanentNegativeList.find((entry) =>
    entry.matchers.some((matcher) => normalizedName.includes(matcher) || normalizedSymbol === matcher),
  );
  if (blocked) {
    return {
      status: "blocked",
      flags: [`Permanent negative list in EIFO policy (§9.3): ${blocked.name}`],
      source: policySource,
    };
  }

  const override = matchOverride(company, overrides);
  if (override === "investment") {
    return {
      status: "blocked",
      flags: ["Marked as an EIFO investment portfolio company (§9.1): direct or indirect trading is prohibited."],
      source: "Manual insider-knowledge override",
    };
  }
  if (override === "loan_or_guarantee") {
    return {
      status: "restricted",
      flags: ["Marked as an EIFO loan/guarantee portfolio company (§9.2): trading allowed with restrictions."],
      notes: loanRestrictionNotes,
      source: "Manual insider-knowledge override",
    };
  }

  const overlapThemes = company.themes.filter((theme) => eifoMandateThemes.has(theme));
  const regionOverlap = company.region ? eifoRegions.has(company.region.toLowerCase()) : false;
  if (overlapThemes.length > 0 || regionOverlap) {
    const reasons = [
      overlapThemes.length > 0 ? `themes: ${overlapThemes.join(", ")}` : undefined,
      regionOverlap ? `${company.region} domicile sits in EIFO's core market` : undefined,
    ].filter(Boolean);
    return {
      status: "possible_overlap",
      flags: [
        `Possible EIFO overlap (${reasons.join("; ")}). Check the monthly investment/loan list.`,
        "No current EIFO investment, loan or guarantee list was provided, so this cannot be confirmed.",
      ],
      source: policySource,
    };
  }

  return {
    status: "unknown",
    flags: ["No current EIFO portfolio or loan list exists in this app, so status cannot be called clean."],
    source: policySource,
  };
}

export { permanentNegativeList };

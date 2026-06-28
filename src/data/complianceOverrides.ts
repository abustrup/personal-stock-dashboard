import type { ComplianceOverrides } from "../lib/compliance";

/**
 * Manual insider-knowledge overrides for EIFO conflicts.
 *
 * The dashboard cannot see EIFO's monthly investment or loan/guarantee lists,
 * so this is where you record what you personally know. Key by ticker symbol
 * (matched exactly) or a lowercased substring of the company name.
 *
 *  - "investment"        → §9.1: direct/indirect trading is prohibited (hard block).
 *  - "loan_or_guarantee" → §9.2: tradeable, but no sale within 6 months of
 *                          acquisition and no speculative derivatives.
 *
 * Example:
 *   export const complianceOverrides: ComplianceOverrides = {
 *     "ORSTED": "investment",
 *     "maersk": "loan_or_guarantee",
 *   };
 *
 * Leave empty if you do not want to encode any private knowledge.
 */
export const complianceOverrides: ComplianceOverrides = {};

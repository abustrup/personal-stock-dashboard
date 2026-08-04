// Presentation helpers shared across the model and UI, so a formatting choice
// (locale, grouping, decimals) lives in exactly one place and never drifts
// between the buy plan, the investability notes and the ledger.

const WHOLE_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole-DKK / whole-number money formatter: thousands-grouped, no decimals. */
export const formatWholeNumber = (value: number): string => WHOLE_NUMBER.format(value);

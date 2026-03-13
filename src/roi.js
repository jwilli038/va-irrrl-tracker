/**
 * roi.js — VA IRRRL ROI / break-even calculator
 *
 * Loan details as of March 2026:
 *   Balance:   $858,024.51
 *   Rate:      6.249%
 *   Matures:   September 2055  → 354 months remaining
 *   VA Fee:    $4,000
 */

const LOAN_BALANCE     = 858024.51;
const CURRENT_RATE_PCT = 6.249;
const REMAINING_MONTHS = 354;   // Sep 2055 − Mar 2026
const VA_FUNDING_FEE   = 4000;

/**
 * Standard monthly mortgage payment formula:
 *   M = P * r(1+r)^n / ((1+r)^n - 1)
 */
function monthlyPayment(principal, annualRatePct, months) {
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  const factor = Math.pow(1 + r, months);
  return principal * (r * factor) / (factor - 1);
}

/**
 * Compute break-even analysis given a proposed new rate.
 * @param {number} newRatePct  Annual rate in percent (e.g. 5.75)
 * @returns {object}
 */
function calcROI(newRatePct) {
  const currentPI    = monthlyPayment(LOAN_BALANCE, CURRENT_RATE_PCT, REMAINING_MONTHS);
  const newPI        = monthlyPayment(LOAN_BALANCE, newRatePct, REMAINING_MONTHS);
  const monthlySavings = currentPI - newPI;
  const breakEvenMonths = monthlySavings > 0
    ? Math.ceil(VA_FUNDING_FEE / monthlySavings)
    : null;

  return {
    loanBalance:     LOAN_BALANCE,
    currentRate:     CURRENT_RATE_PCT,
    newRate:         newRatePct,
    remainingMonths: REMAINING_MONTHS,
    currentPI:       parseFloat(currentPI.toFixed(2)),
    newPI:           parseFloat(newPI.toFixed(2)),
    monthlySavings:  parseFloat(monthlySavings.toFixed(2)),
    vaFundingFee:    VA_FUNDING_FEE,
    breakEvenMonths,
    breakEvenYears:  breakEvenMonths ? parseFloat((breakEvenMonths / 12).toFixed(1)) : null,
  };
}

module.exports = { calcROI };

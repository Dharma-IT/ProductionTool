export function isOrderHistoryEligible(row) {
  const treatment = String(row.treatment ?? '')
    .toLowerCase()
    .replace(/^\s*\d+\s*x\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^subscription\s+/, '')
  return !/^(?:berberine\b|glp\s*1\s+support\b|beauty\s+boost\b|multi\s*vitamin\b|apple\s+(?:cider|scider)\s+vinegar\b|(?:personalized\s+)?nutrition\s+consultation\b)/.test(treatment)
}

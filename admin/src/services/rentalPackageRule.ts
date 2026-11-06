export interface RentalPackageRule {
  firstHourFare: number;
  additionalHourFare: number;
  partnerPerHour: number;
  includedKm: number;
  kmMode: 'per_hour' | 'per_trip';
  extraKmRate: number;
  extraHourRate: number;
}
export function rentalRulePackages(rule: RentalPackageRule) {
  const round = (value: number) => Math.round(value * 100) / 100;
  return Object.fromEntries(Array.from({ length: 15 }, (_, i) => {
    const h = i + 1;
    return [String(h), {
      customerFare: round(rule.firstHourFare + i * rule.additionalHourFare),
      partnerPayout: round(h * rule.partnerPerHour),
      includedKm: round(rule.kmMode === 'per_hour' ? h * rule.includedKm : rule.includedKm),
      extraKmRate: rule.extraKmRate,
      extraHourRate: rule.extraHourRate,
    }];
  }));
}

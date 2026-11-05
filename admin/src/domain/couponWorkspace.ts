/** Partition existing records without converting their eligibility schema or touching stored data. */
export const isCampaignCoupon = (coupon: { audience?: unknown }): boolean => !!coupon.audience;

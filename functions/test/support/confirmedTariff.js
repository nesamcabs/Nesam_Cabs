// TEST FIXTURE ONLY. Sample rate card for the unit tests; production prices come from the admin panel (business_config/tariff_v2).
const CONFIRMED_TARIFF_V2 = {
  gstRate: 0.05,
  oneWay: {
    minKm: 130,
    classes: {
      sedan: { customerRate: 15, customerBata: 400, partnerRate: 13.5, partnerBata: 300 },
      suv: { customerRate: 20, customerBata: 400, partnerRate: 18, partnerBata: 300 },
      crysta: { customerRate: 26, customerBata: 600, partnerRate: 24, partnerBata: 400 },
    },
  },
  roundTrip: {
    maxDays: 30,
    miniMaxHours: 7,
    miniMaxKm: 150,
    classes: {
      sedan: { customerRate: 14, customerBata: 400, partnerRate: 12.6, partnerBata: 300, minKmPerDay: 250, miniFare: 2600, miniPartnerFare: 2340 },
      suv: { customerRate: 19, customerBata: 400, partnerRate: 17.1, partnerBata: 300, minKmPerDay: 250, miniFare: 3400, miniPartnerFare: 3060 },
      crysta: { customerRate: 22, customerBata: 500, partnerRate: 20, partnerBata: 400, minKmPerDay: 300, miniFare: 4700, miniPartnerFare: 4230 },
    },
  },
  rental: {
    classes: {
      sedan: { firstHour: 500, laterHour: 350, minHours: 4, minTimeFare: 1550, partnerPerHour: 250 },
      suv: { firstHour: 700, laterHour: 450, minHours: 5, minTimeFare: 2500, partnerPerHour: 400 },
      crysta: { firstHour: 800, laterHour: 600, minHours: 10, minTimeFare: 6200, partnerPerHour: 500 },
    },
  },
  cityDrop: {
    baseKm: 20,
    zones: [],
    classes: {
      sedan: { customerBase: 800, customerExtraKm: 35, partnerBase: 500, partnerExtraKm: 25 },
      suv: { customerBase: 1200, customerExtraKm: 50, partnerBase: 700, partnerExtraKm: 35 },
      crysta: { customerBase: 2000, customerExtraKm: 70, partnerBase: 1200, partnerExtraKm: 50 },
    },
  },
};

module.exports = { CONFIRMED_TARIFF_V2 };

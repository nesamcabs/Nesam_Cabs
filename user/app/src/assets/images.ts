// Centralized, typed asset registry for NESAM customer app.
// Uses explicit static require() calls compatible with React Native and Metro bundler.
import type { ImageSourcePropType } from 'react-native';

export const BRAND = {
  logo: require('../../assets/logo.png') as ImageSourcePropType,
  icon: require('../../assets/icon.png') as ImageSourcePropType,
  adaptiveIcon: require('../../assets/adaptive-icon.png') as ImageSourcePropType,
  splashIcon: require('../../assets/splash-icon.png') as ImageSourcePropType,
} as const;

/** Artwork taken from the customer reference design (optimized local copies). */
export const REFERENCE = {
  emblem: require('../../assets/reference/brand/emblem.png') as ImageSourcePropType,
} as const;

/** White vehicle photos from the reference, keyed by its photo groups. */
export const CAB_PHOTOS = {
  sedan: require('../../assets/reference/vehicles/sedan.webp') as ImageSourcePropType,
  ertiga: require('../../assets/reference/vehicles/ertiga.webp') as ImageSourcePropType,
  carens: require('../../assets/reference/vehicles/carens.webp') as ImageSourcePropType,
  innova: require('../../assets/reference/vehicles/innova.webp') as ImageSourcePropType,
  crysta: require('../../assets/reference/vehicles/crysta.webp') as ImageSourcePropType,
} as const;

/** Red landmark illustrations for the popular routes (Trichy/Madurai are halves of one reference drawing). */
export const ROUTE_ART = {
  trichy: require('../../assets/reference/routes/trichy.webp') as ImageSourcePropType,
  madurai: require('../../assets/reference/routes/madurai.webp') as ImageSourcePropType,
  thanjavur: require('../../assets/reference/routes/thanjavur.webp') as ImageSourcePropType,
  puducherry: require('../../assets/reference/routes/puducherry.webp') as ImageSourcePropType,
  coimbatore: require('../../assets/reference/routes/coimbatore.webp') as ImageSourcePropType,
  rameswaram: require('../../assets/reference/routes/rameswaram.webp') as ImageSourcePropType,
} as const;

export const HEROES = {
  mobile: require('../../assets/website-images/web/heroes/hero-mobile.webp') as ImageSourcePropType,
  desktop: require('../../assets/website-images/web/heroes/hero-desktop.webp') as ImageSourcePropType,
  centered: require('../../assets/website-images/web/heroes/hero-centered.webp') as ImageSourcePropType,
  family: require('../../assets/website-images/web/heroes/hero-family.webp') as ImageSourcePropType,
} as const;

export const DESTINATIONS = {
  chennaiPondicherry: require('../../assets/website-images/web/destinations/route-chennai-pondicherry.webp') as ImageSourcePropType,
  chennaiBangalore: require('../../assets/website-images/web/destinations/route-chennai-bangalore.webp') as ImageSourcePropType,
  coimbatoreOoty: require('../../assets/website-images/web/destinations/route-coimbatore-ooty.webp') as ImageSourcePropType,
  maduraiRameshwaram: require('../../assets/website-images/web/destinations/route-madurai-rameshwaram.webp') as ImageSourcePropType,
  chennai: require('../../assets/website-images/web/destinations/destination-chennai.webp') as ImageSourcePropType,
  kodaikanal: require('../../assets/website-images/web/destinations/destination-kodaikanal.webp') as ImageSourcePropType,
  madurai: require('../../assets/website-images/web/destinations/destination-madurai.webp') as ImageSourcePropType,
  coimbatore: require('../../assets/website-images/web/destinations/destination-coimbatore.webp') as ImageSourcePropType,
  thanjavur: require('../../assets/website-images/web/destinations/destination-thanjavur.webp') as ImageSourcePropType,
  trichy: require('../../assets/website-images/web/destinations/destination-trichy.webp') as ImageSourcePropType,
} as const;

export const VEHICLES = {
  sedan: require('../../assets/vehicles/sedan.webp') as ImageSourcePropType,
  suv: require('../../assets/vehicles/suv.webp') as ImageSourcePropType,
  mpv: require('../../assets/vehicles/mpv.webp') as ImageSourcePropType,
  premiumSedan: require('../../assets/vehicles/premium-sedan.webp') as ImageSourcePropType,
  hatchback: require('../../assets/vehicles/hatchback.webp') as ImageSourcePropType,
  minibus: require('../../assets/vehicles/minibus.webp') as ImageSourcePropType,
  passengerVan: require('../../assets/vehicles/passenger-van.webp') as ImageSourcePropType,
  touristCoach: require('../../assets/vehicles/tourist-coach.webp') as ImageSourcePropType,
} as const;

export const ILLUSTRATIONS = {
  welcome: require('../../assets/art/welcome.webp') as ImageSourcePropType,
  phoneVerification: require('../../assets/art/phone-verification.webp') as ImageSourcePropType,
  profileSetup: require('../../assets/art/profile-setup.webp') as ImageSourcePropType,
  accountReview: require('../../assets/art/account-review.webp') as ImageSourcePropType,
  bookJourney: require('../../assets/art/book-journey.webp') as ImageSourcePropType,
  bookingConfirmed: require('../../assets/art/booking-confirmed.webp') as ImageSourcePropType,
  chooseVehicle: require('../../assets/art/choose-vehicle.webp') as ImageSourcePropType,
  driverArriving: require('../../assets/art/driver-arriving.webp') as ImageSourcePropType,
  journeyProgress: require('../../assets/art/journey-progress.webp') as ImageSourcePropType,
  tripCompleted: require('../../assets/art/trip-completed.webp') as ImageSourcePropType,
  error: require('../../assets/art/error.webp') as ImageSourcePropType,
  offline: require('../../assets/art/offline.webp') as ImageSourcePropType,
  support: require('../../assets/art/support.webp') as ImageSourcePropType,
  noNotifications: require('../../assets/art/no-notifications.webp') as ImageSourcePropType,
  noOffers: require('../../assets/art/no-offers.webp') as ImageSourcePropType,
  noPayments: require('../../assets/art/no-payments.webp') as ImageSourcePropType,
  noSavedPlaces: require('../../assets/art/no-saved-places.webp') as ImageSourcePropType,
  noTrips: require('../../assets/art/no-trips.webp') as ImageSourcePropType,
} as const;

export const FEATURES = {
  cleanAc: require('../../assets/website-images/web/features/feature-clean-ac.webp') as ImageSourcePropType,
  chauffeur: require('../../assets/website-images/web/features/feature-chauffeur.webp') as ImageSourcePropType,
  transparentFare: require('../../assets/website-images/web/features/feature-transparent-fare.webp') as ImageSourcePropType,
  support: require('../../assets/website-images/web/features/feature-support.webp') as ImageSourcePropType,
} as const;

export const PHOTOGRAPHY = {
  serviceOneWay: require('../../assets/website-images/web/photography/service-one-way.webp') as ImageSourcePropType,
  serviceRoundTrip: require('../../assets/website-images/web/photography/service-round-trip.webp') as ImageSourcePropType,
  serviceAirport: require('../../assets/website-images/web/photography/service-airport.webp') as ImageSourcePropType,
  servicePilgrimage: require('../../assets/website-images/web/photography/service-pilgrimage.webp') as ImageSourcePropType,
  serviceFamily: require('../../assets/website-images/web/photography/service-family.webp') as ImageSourcePropType,
  serviceCorporate: require('../../assets/website-images/web/photography/service-corporate.webp') as ImageSourcePropType,
  serviceGroup: require('../../assets/website-images/web/photography/service-group.webp') as ImageSourcePropType,
  trustDriver: require('../../assets/website-images/web/photography/trust-driver.webp') as ImageSourcePropType,
  trustInterior: require('../../assets/website-images/web/photography/trust-interior.webp') as ImageSourcePropType,
  trustSupport: require('../../assets/website-images/web/photography/trust-support.webp') as ImageSourcePropType,
  aboutFleet: require('../../assets/website-images/web/photography/about-fleet.webp') as ImageSourcePropType,
} as const;

export const BACKGROUNDS = {
  offer: require('../../assets/website-images/web/backgrounds/offer-background.webp') as ImageSourcePropType,
  appPromotion: require('../../assets/website-images/web/backgrounds/app-promotion-background.webp') as ImageSourcePropType,
  socialCover: require('../../assets/website-images/web/backgrounds/social-cover.webp') as ImageSourcePropType,
} as const;

/**
 * Returns the matching vehicle image asset for any category name or vehicle model.
 * Falls back to sedan.
 */
export function getVehicleImage(categoryName = ''): ImageSourcePropType {
  const norm = categoryName.toLowerCase();
  if (norm.includes('crysta') || norm.includes('premium suv')) return CAB_PHOTOS.crysta;
  if (norm.includes('innova')) return CAB_PHOTOS.innova;
  if (norm.includes('carens') || norm.includes('7+1')) return CAB_PHOTOS.carens;
  if (norm.includes('suv') || norm.includes('6+1') || norm.includes('ertiga') || norm.includes('marazzo') || norm.includes('scorpio') || norm.includes('bolero') || norm.includes('mpv')) {
    return CAB_PHOTOS.ertiga;
  }
  if (norm.includes('premium')) {
    return VEHICLES.premiumSedan;
  }
  if (norm.includes('hatchback') || norm.includes('mini') || norm.includes('wagonr')) {
    return VEHICLES.hatchback;
  }
  if (norm.includes('bus') || norm.includes('tempo') || norm.includes('traveller') || norm.includes('minibus')) {
    return VEHICLES.minibus;
  }
  if (norm.includes('van')) {
    return VEHICLES.passengerVan;
  }
  if (norm.includes('coach')) {
    return VEHICLES.touristCoach;
  }
  return CAB_PHOTOS.sedan;
}

/**
 * Returns a high-quality route corridor photograph matching the given from and to locations.
 */
export function getRouteImage(from: string, to: string): ImageSourcePropType {
  const f = from.toLowerCase();
  const t = to.toLowerCase();

  if ((f.includes('chennai') && t.includes('pondi')) || (f.includes('pondi') && t.includes('chennai'))) {
    return DESTINATIONS.chennaiPondicherry;
  }
  if ((f.includes('chennai') && t.includes('bangalore')) || (f.includes('chennai') && t.includes('bengaluru')) || (f.includes('bangalore') && t.includes('chennai')) || (f.includes('bengaluru') && t.includes('chennai'))) {
    return DESTINATIONS.chennaiBangalore;
  }
  if ((f.includes('coimbatore') && t.includes('ooty')) || (f.includes('ooty') && t.includes('coimbatore'))) {
    return DESTINATIONS.coimbatoreOoty;
  }
  if ((f.includes('madurai') && t.includes('rameshwaram')) || (f.includes('rameshwaram') && t.includes('madurai'))) {
    return DESTINATIONS.maduraiRameshwaram;
  }
  if (t.includes('kodaikanal') || f.includes('kodaikanal')) {
    return DESTINATIONS.kodaikanal;
  }
  if (t.includes('thanjavur') || f.includes('thanjavur')) {
    return DESTINATIONS.thanjavur;
  }
  if (t.includes('trichy') || t.includes('tiruchirappalli') || f.includes('trichy') || f.includes('tiruchirappalli')) {
    return DESTINATIONS.trichy;
  }
  if (t.includes('madurai') || f.includes('madurai')) {
    return DESTINATIONS.madurai;
  }
  if (t.includes('coimbatore') || f.includes('coimbatore')) {
    return DESTINATIONS.coimbatore;
  }
  if (t.includes('chennai') || f.includes('chennai')) {
    return DESTINATIONS.chennai;
  }
  // Default corridor photo
  return DESTINATIONS.chennaiPondicherry;
}


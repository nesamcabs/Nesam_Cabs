// Copied unchanged from vendor/web/src/config/onboarding.ts (import path adapted).
import type { BusinessRegType, IdentityProofType, OnboardingSection } from '../types/vendor';

export const VENDOR_KYC_COLLECTION = 'vendor_kyc';
export const VENDOR_INVITES_COLLECTION = 'vendor_invites';

/** Must match storage.rules validUpload(). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_UPLOAD_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';
export const MAX_FILES_PER_FIELD = 10;

export const VEHICLE_TYPES = [
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Tempo Traveller',
  'Mini Bus',
  'Bus',
  'Commercial',
] as const;

export const BUSINESS_REG_TYPES: { value: BusinessRegType; label: string; placeholder: string }[] = [
  { value: 'GST', label: 'GST Certificate', placeholder: '33ABCDE1234F1Z5' },
  { value: 'BUSINESS_REGISTRATION', label: 'Business Registration', placeholder: 'U12345TN2020PTC123456' },
  { value: 'TRADE_LICENSE', label: 'Trade License', placeholder: 'TL/2024/001234' },
];

export const IDENTITY_PROOF_TYPES: { value: IdentityProofType; label: string; placeholder: string }[] = [
  { value: 'AADHAAR', label: 'Aadhaar Card', placeholder: '1234 5678 9012' },
  { value: 'PAN', label: 'PAN Card', placeholder: 'ABCDE1234F' },
  { value: 'PASSPORT', label: 'Passport', placeholder: 'A1234567' },
];

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

/**
 * Wizard order: business + account details, then identity & business
 * documents, then fleet documentation, then review & submit.
 * Index == onboardingStep stored on the vendor doc.
 * Admin-flagged 'payout' maps to step 0 (business); 'documents' maps to step 1.
 */
export const ONBOARDING_STEPS: { key: OnboardingSection | 'review'; title: string; short: string }[] = [
  { key: 'business', title: 'Business & account details', short: 'Business' },
  { key: 'documents', title: 'Identity & business docs', short: 'Documents' },
  { key: 'fleet', title: 'Fleet documentation', short: 'Fleet' },
  { key: 'review', title: 'Review & Submit', short: 'Submit' },
];

/** The wizard step an admin-flagged section belongs to. */
export function stepOfSection(section: OnboardingSection | 'review'): number {
  if (section === 'documents') return 1;
  if (section === 'fleet') return 2;
  if (section === 'review') return 3;
  // 'business' | 'payout' → step 0
  return 0;
}

export const SECTION_LABELS: Record<OnboardingSection, string> = {
  business: 'Business details',
  documents: 'Documents',
  fleet: 'Fleet documentation',
  payout: 'Account details',
};

/** Storage sub-folders under vendors/{uid}/onboarding/. */
export type UploadCategory =
  | 'business_registration'
  | 'identity_proof'
  | 'vehicle_rc'
  | 'vehicle_photos'
  | 'vehicle_insurance'
  | 'vehicle_fc'
  | 'vehicle_permit';

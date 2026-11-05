// Public contact details already published by this site (index.html structured data and footer).
// The phone number itself comes from the shared app constants (SUPPORT_PHONE).
export const CONTACT = {
  email: 'support@nesamcabs.com',
  addressLine: 'Theni, Tamil Nadu 625531, India',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('NESAM Tours and Travels, Theni, Tamil Nadu 625531'),
} as const;

/** wa.me link for the support number (digits only, country code included). */
export const whatsappLink = (phoneE164: string, text?: string) => `https://wa.me/${phoneE164.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

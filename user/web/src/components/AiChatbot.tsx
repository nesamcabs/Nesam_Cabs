// NESAM Cabs AI travel guide. The chat itself is shared (AiChatWidget); this is this site's wording and icons.
import { AiChatWidget, type ChatBrand } from './AiChatWidget';
import { Icon } from './Icon';

const BRAND: ChatBrand = {
  id: 'nesam',
  variant: 'nesam',
  assistantName: 'NESAM Travel Advisor',
  welcome: {
    en: `Hello! 👋 Welcome to **NESAM Cabs**. I'm your AI travel guide.\n\nI can help with:\n• **One-way drop fares**: pay for one way, not the return\n• **Round trips, airport rides and city rentals**\n• **Choosing the right cab**: Sedan, SUV, Innova Crysta, vans\n• **Upfront fares and our policies**\n\nHow can I help you today?`,
    ta: `வணக்கம்! 👋 **NESAM Cabs** க்கு வரவேற்கிறோம். நான் உங்கள் AI பயண வழிகாட்டி.\n\nநான் உதவக்கூடியவை:\n• **ஒருவழி டிராப் கட்டணம்**: ஒரு வழிக்கான கட்டணம் மட்டுமே\n• **சுற்றுப் பயணம், விமான நிலையம், உள்ளூர் வாடகை**\n• **சரியான காரைத் தேர்வு செய்ய**: Sedan, SUV, Innova Crysta, வேன்\n• **முன்கூட்டியே தெரியும் கட்டணம், எங்கள் கொள்கைகள்**\n\nஇன்று நான் எப்படி உதவலாம்?`,
  },
  prompts: {
    en: ['How do one-way fares work?', 'What car types are available?', 'What is the cancellation policy?', 'How do I book an airport taxi?', 'Do you offer Multicity trips?'],
    ta: ['ஒருவழி கட்டணம் எப்படி?', 'என்ன கார்கள் உள்ளன?', 'ரத்து கொள்கை என்ன?', 'விமான நிலைய டாக்ஸி புக்கிங்', 'Multicity பயணங்கள் உண்டா?'],
  },
  placeholder: { en: 'Ask about fares, cabs, routes…', ta: 'கட்டணம், கார், வழி பற்றிக் கேளுங்கள்…' },
};

export function AiChatbot() {
  return <AiChatWidget brand={BRAND} Icon={Icon} closeIcon="xmark" />;
}

export default AiChatbot;

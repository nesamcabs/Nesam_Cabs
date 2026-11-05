// NESAM Cabs AI travel advisor. The chat itself is shared (AiChatWidget); this is NESAM's wording.
import { AiChatWidget, type ChatBrand } from './AiChatWidget';
import { Icon } from './Icon';

const BRAND: ChatBrand = {
  id: 'nesam',
  variant: 'nesam',
  assistantName: 'NESAM Travel Advisor',
  welcome: {
    en: `Hello! 👋 Welcome to **NESAM Cabs & Travels**. I'm your AI travel advisor.\n\nAsk me about:\n• **One-way drops & round trips** across Tamil Nadu, Bengaluru, Kerala\n• **Fares shown upfront**, with no surge pricing\n• **Cars**: Sedan, SUV, Innova Crysta and vans\n• **Airport rides, local rentals and Multicity tours**\n\nHow can I help plan your trip?`,
    ta: `வணக்கம்! 👋 **NESAM Cabs & Travels** க்கு வரவேற்கிறோம். நான் உங்கள் AI பயண ஆலோசகர்.\n\nஇவற்றைப் பற்றிக் கேளுங்கள்:\n• தமிழ்நாடு, பெங்களூரு, கேரளா முழுவதும் **ஒருவழி டிராப் & சுற்றுப் பயணம்**\n• **முன்கூட்டியே தெரியும் கட்டணம்**, பீக் நேர கூடுதல் கட்டணம் இல்லை\n• **கார்கள்**: Sedan, SUV, Innova Crysta, வேன்\n• **விமான நிலையம், உள்ளூர் வாடகை, Multicity சுற்றுலா**\n\nஉங்கள் பயணத்தைத் திட்டமிட நான் எப்படி உதவலாம்?`,
  },
  prompts: {
    en: ['Check one-way fares', 'What car types do you have?', 'What is the cancellation policy?', 'How do I book an airport ride?', 'Plan a Multicity tour'],
    ta: ['ஒருவழி கட்டணம் அறிய', 'என்ன கார்கள் உள்ளன?', 'ரத்து கொள்கை என்ன?', 'விமான நிலைய பயணம் புக்கிங்', 'Multicity சுற்றுலா திட்டமிட'],
  },
  placeholder: { en: 'Ask about fares, cabs, routes…', ta: 'கட்டணம், கார், வழி பற்றிக் கேளுங்கள்…' },
};

export function AiChatbot() {
  return <AiChatWidget brand={BRAND} Icon={Icon} />;
}

export default AiChatbot;

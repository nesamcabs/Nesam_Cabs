import { describe, expect, it } from 'vitest';
import {
  buildAiLeadSubmission,
  detectClientConfusion,
  isValidLeadPhone,
  validateAiLeadField,
  validateAiLeadForm,
} from './aiChatLead';

describe('aiChatLead', () => {
  it('detects AI confusion from server flags, failures, or client fallback phrases', () => {
    expect(detectClientConfusion({ serverConfused: true, confusionReason: 'ai_escalated', replyText: 'Let me connect you.', userQuery: 'corporate contract' })).toEqual({
      confused: true,
      reason: 'ai_escalated',
    });
    expect(detectClientConfusion({ serverConfused: false, replyText: 'Enter pickup and drop.', userQuery: 'how to book?' })).toEqual({
      confused: false,
    });
    expect(detectClientConfusion({ requestFailed: true, replyText: '', userQuery: 'fare?' })).toEqual({
      confused: true,
      reason: 'ai_unavailable',
    });
    // Fallback detection when an older server response omits confused boolean
    expect(detectClientConfusion({ replyText: "Sorry, I couldn't understand that.", userQuery: 'weird question' })).toEqual({
      confused: true,
      reason: 'ai_uncertain',
    });
    expect(detectClientConfusion({ replyText: 'Call us on +91 90250 99990', userQuery: 'Please ask a human to call me' })).toEqual({
      confused: true,
      reason: 'human_requested',
    });
  });

  it('validates lead fields cleanly in English and Tamil', () => {
    expect(isValidLeadPhone('9876543210')).toBe(true);
    expect(isValidLeadPhone('+91 98765 43210')).toBe(true);
    expect(isValidLeadPhone('12345')).toBe(false);
    expect(validateAiLeadField('name', 'A', 'en')).toMatch(/at least 2/i);
    expect(validateAiLeadField('phone', '999', 'ta')).toMatch(/10 இலக்க/);
    expect(validateAiLeadForm({ name: 'Arun', phone: '9876543210', notes: 'Need Ooty cab quote' }, 'en')).toEqual({});
  });

  it('builds structured AI lead submission payloads per brand', () => {
    const payload = buildAiLeadSubmission({
      brandId: 'people_taxi',
      draft: { name: 'Meena', phone: '+91 98765 43210', notes: 'Need 2 Innovas for Munnar weekend trip' },
      lang: 'en',
      aiQuestion: 'Can I book 2 Innovas with roof carriers for Munnar?',
      aiReply: 'Please share your details for our travel desk.',
      reason: 'ai_escalated',
      tripContext: { pickup: 'Theni', drop: 'Munnar', service: 'Round Trip' },
      pagePath: '/book?service=outstation',
      messages: [
        { role: 'user', content: 'Can I book 2 Innovas with roof carriers for Munnar?' },
        { role: 'assistant', content: 'Please share your details for our travel desk.' },
      ],
    });
    expect(payload.brand).toBe('people_taxi');
    expect(payload.source).toBe('ai-chat');
    expect(payload.category).toBe('AI assistant lead');
    expect(payload.aiLead.tripContext).toEqual({ service: 'Round Trip', pickup: 'Theni', drop: 'Munnar' });
    expect(payload.aiLead.messages).toHaveLength(2);
  });
});

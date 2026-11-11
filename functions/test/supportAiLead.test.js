const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../lib/admin');

const created = [];
const notifications = [];
let seq = 0;

admin.db.collection = (name) => ({
  doc: (id) => ({ id: id || `doc_${name}_${++seq}`, path: `${name}/${id || `doc_${name}_${seq}`}` }),
  add: async (data) => {
    const id = `added_${name}_${++seq}`;
    notifications.push({ id, name, data });
    return { id };
  },
  where: () => ({
    limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    get: async () => ({ empty: true, docs: [] }),
  }),
});
admin.db.doc = (path) => ({
  id: path.split('/').pop(),
  path,
  get: async () => ({ exists: false, data: () => undefined }),
});
admin.db.runTransaction = async (fn) => fn({
  create(ref, data) {
    created.push({ ref, data });
  },
  get: async () => ({ exists: false, data: () => undefined }),
  update() {},
  set() {},
});

const { submitSupportRequest, parseAiLead } = require('../lib/support');

const req = (data, uid) => ({
  data,
  ...(uid ? { auth: { uid } } : {}),
  rawRequest: { headers: {}, ip: `ai-lead-test-${++seq}` },
});

test('parseAiLead extracts sanitized question, reply, tripContext and capped messages', () => {
  const lead = parseAiLead({
    aiLead: {
      question: 'Can we take 2 pets in an Innova to Ooty?',
      reply: 'Let me connect you with our team so we can confirm pet policy.',
      reason: 'ai_escalated',
      language: 'en',
      pagePath: '/book?service=outstation',
      tripContext: { pickup: 'Theni', drop: 'Ooty', service: 'Outstation' },
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Can we take 2 pets in an Innova to Ooty?' },
      ],
    },
  });
  assert.equal(lead.question, 'Can we take 2 pets in an Innova to Ooty?');
  assert.equal(lead.reason, 'ai_escalated');
  assert.equal(lead.tripContext.pickup, 'Theni');
  assert.equal(lead.tripContext.drop, 'Ooty');
  assert.equal(lead.messages.length, 3);
});

test('submitSupportRequest saves AI chat leads for all three brands as visitor', async () => {
  created.length = 0;
  for (const [brandIn, expectedBrand] of [
    ['people_taxi', 'people_taxi'],
    ['onewaycarrentals', 'onewaycarrentals'],
    ['nesam', 'nesam'],
  ]) {
    const res = await submitSupportRequest.run(req({
      brand: brandIn,
      name: 'Karthik',
      phone: '9876543210',
      source: 'ai-chat',
      category: 'AI assistant lead',
      message: 'Need 2 Tempo Travellers for Kodaikanal weekend trip',
      aiLead: {
        question: 'Can I book 2 tempo travellers together?',
        reply: 'Let me connect you with our team for group pricing.',
        reason: 'ai_escalated',
        language: 'en',
        tripContext: { pickup: 'Madurai', drop: 'Kodaikanal', service: 'Outstation' },
      },
    }));
    assert.ok(res.id);
    const saved = created.filter((entry) => entry.ref.path.startsWith('support_tickets/')).at(-1);
    assert.equal(saved.data.brand, expectedBrand);
    assert.equal(saved.data.source, 'ai-chat');
    assert.equal(saved.data.category, 'AI assistant lead');
    assert.equal(saved.data.customerName, 'Karthik');
    assert.equal(saved.data.customerPhone, '9876543210');
    assert.equal(saved.data.status, 'Open');
    assert.equal(saved.data.aiLead.question, 'Can I book 2 tempo travellers together?');
    assert.equal(saved.data.aiLead.tripContext.drop, 'Kodaikanal');
  }
});

test('submitSupportRequest validates AI lead fields and respects honeypot', async () => {
  const bot = await submitSupportRequest.run(req({ website: 'http://spam.example', name: 'Bot', phone: '9876543210', source: 'ai-chat', message: 'spam link' }));
  assert.equal(bot.id, 'received');

  await assert.rejects(
    submitSupportRequest.run(req({ brand: 'people_taxi', name: 'A', phone: '9876543210', source: 'ai-chat', message: 'Need callback' })),
    { code: 'invalid-argument' },
  );
  await assert.rejects(
    submitSupportRequest.run(req({ brand: 'people_taxi', name: 'Priya', phone: '123', source: 'ai-chat', message: 'Need callback' })),
    { code: 'invalid-argument' },
  );
  await assert.rejects(
    submitSupportRequest.run(req({ brand: 'onewaycarrentals', name: 'Priya', source: 'ai-chat', message: 'Need callback' })),
    { code: 'invalid-argument' },
  );
  // Short message falls back cleanly when aiQuestion is supplied for AI leads.
  const shortLead = await submitSupportRequest.run(req({
    brand: 'nesam',
    name: 'Priya',
    phone: '+91 98765 43210',
    source: 'ai-chat',
    aiLead: { question: 'Corporate invoice GST doubt', reason: 'unrecognized_intent' },
  }));
  assert.ok(shortLead.id);
});

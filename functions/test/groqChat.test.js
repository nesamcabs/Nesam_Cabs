const test = require('node:test');
const assert = require('node:assert/strict');
const { chatWithBot } = require('../lib/groqChat');

let sequence = 0;
const request = (messages, extra = {}) => ({
  data: { brand: 'nesam', messages, ...extra },
  rawRequest: { headers: {}, ip: `chat-test-${sequence++}` },
});
const user = (content) => ({ role: 'user', content });

test('chat validates requests, answers basic questions and preserves Groq conversation', async () => {
  const oldKey = process.env.GROQ_API_KEY;
  const oldFetch = global.fetch;
  try {
    delete process.env.GROQ_API_KEY;
    await assert.rejects(chatWithBot.run(request([])), { code: 'invalid-argument' });
    const hello = await chatWithBot.run(request([user('hai hai')]));
    const wellbeing = await chatWithBot.run(request([user('hellow how are you')]));
    const fare = await chatWithBot.run(request([user('how much is the fare?')]));
    assert.equal(hello.reason, 'not_configured');
    assert.match(hello.message, /Where would you like to travel/);
    assert.match(wellbeing.message, /ready to help/);
    assert.notEqual(fare.message, hello.message);
    const tamil = await chatWithBot.run(request([user('hello')], { language: 'ta' }));
    assert.match(tamil.message, /வணக்கம்/);
    const tanglishBooking = await chatWithBot.run(request([user('naan epdi book pannurathu')]));
    assert.equal(tanglishBooking.language, 'tanglish');
    assert.match(tanglishBooking.message, /Home page-la service select pannunga/);
    const tanglishGreeting = await chatWithBot.run(request([user('hai thaal')]));
    assert.equal(tanglishGreeting.language, 'tanglish');
    assert.match(tanglishGreeting.message, /Enga irundhu enga poganum/);
    const tanglishFollowup = await chatWithBot.run(request([user('enaku booking help venum'), { role: 'assistant', content: 'Sure, sollunga.' }, user('aama')]));
    assert.equal(tanglishFollowup.language, 'tanglish');
    const luggageFollowup = await chatWithBot.run(request([user('naan chennai to madurai 5 peru porom'), { role: 'assistant', content: 'Luggage evlo?' }, user('3 bag iruku, ippo sollu')]));
    assert.equal(luggageFollowup.language, 'tanglish');

    process.env.GROQ_API_KEY = 'test-key';
    const messages = [user('Chennai to Madurai, 6 passengers'), { role: 'assistant', content: 'Do you have luggage?' }, user('Yes, three bags')];
    let calls = [];
    global.fetch = async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'An SUV may fit; confirm luggage capacity before booking.' } }] }) };
    };
    const live = await chatWithBot.run(request(messages));
    assert.equal(live.provider, 'groq');
    assert.deepEqual(calls[0].messages.slice(1), messages);
    assert.match(calls[0].messages[0].content, /Never repeat the welcome/);

    calls = [];
    await chatWithBot.run(request([user('naan epdi book pannurathu')]));
    assert.match(calls[0].messages[0].content, /Reply in natural Tanglish/);
    assert.match(calls[0].messages[0].content, /Infer the intended meaning/);
    assert.match(calls[0].messages[0].content, /Do not claim the app collects passenger\/luggage counts/);

    calls = [];
    global.fetch = async () => {
      calls.push(1);
      return { ok: false, status: 401 };
    };
    const authFailure = await chatWithBot.run(request([user('hello')]));
    assert.equal(authFailure.reason, 'authentication');
    assert.equal(calls.length, 1);

    calls = [];
    global.fetch = async () => {
      calls.push(1);
      return calls.length === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ choices: [{ message: { content: 'A different answer.' } }] }) };
    };
    assert.equal((await chatWithBot.run(request([user('what cars?')]))).provider, 'groq');
    assert.equal(calls.length, 2);
    global.fetch = async () => { throw new Error('connection failed'); };
    assert.equal((await chatWithBot.run(request([user('payment')]))).reason, 'network');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

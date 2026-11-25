const test = require('node:test');
const assert = require('node:assert/strict');
const { cityByPincode, zoneByPincode, pinsOfCity, stateCodeOf } = require('../lib/domain/pincodeLookup');

const city = (id, name, state = 'Tamil Nadu', extra = {}) => ({ id, names: [name], state, ...extra });

test('state codes and names both resolve', () => {
  assert.equal(stateCodeOf('33'), '33');
  assert.equal(stateCodeOf('Tamil Nadu'), '33');
  assert.equal(stateCodeOf('tamil nadu'), '33');
  assert.equal(stateCodeOf('Atlantis'), '');
});

test('India Post lists every Theni pincode, not just the town', () => {
  const theni = pinsOfCity('Theni', 'Tamil Nadu');
  assert.equal(theni.size, 31);
  for (const pin of ['625531', '625601', '625516', '625513']) assert.ok(theni.has(pin), pin); // Theni, Periyakulam, Cumbum, Bodinayakanur
  assert.equal(pinsOfCity('Theni', 'Kerala'), null);       // another state has no Theni
  assert.equal(pinsOfCity('No Such City', 'Tamil Nadu'), null);
});

test('a district City owns the pincodes of its whole district, even where the address never names it', () => {
  const cities = [city('theni', 'Theni'), city('dindigul', 'Dindigul')];
  assert.equal(cityByPincode('625516', cities), 'theni');   // Cumbum
  assert.equal(cityByPincode('625601', cities), 'theni');   // Periyakulam
  assert.equal(cityByPincode('624401', cities), 'dindigul'); // Natham
  assert.equal(cityByPincode('600001', cities), null);       // Chennai: neither
  assert.equal(cityByPincode('12345', cities), null);        // not a pincode
});

test('a town City beats its district, and a wrong state never matches', () => {
  const cities = [city('krishnagiri', 'Krishnagiri'), city('hosur', 'Hosur')];
  assert.equal(cityByPincode('635109', cities), 'hosur');          // a Hosur post office
  assert.equal(cityByPincode('635001', cities), 'krishnagiri');    // Krishnagiri town
  assert.equal(cityByPincode('625516', [city('theni', 'Theni', 'Kerala')]), null);
});

test('pincodes saved on a City record win over the directory', () => {
  const cities = [city('theni', 'Theni'), city('custom', 'Cumbum valley', 'Tamil Nadu', { pincodes: ['625516'] })];
  assert.equal(cityByPincode('625516', cities), 'custom');
  assert.equal(cityByPincode('625601', cities), 'theni');
});

test('a zone is found by its pincode; the smaller zone wins an overlap', () => {
  const zones = [
    { id: 'big', parentId: 'theni', pincodes: ['625601', '625602', '625603'] },
    { id: 'small', parentId: 'theni', pincodes: ['625602'] },
  ];
  assert.equal(zoneByPincode('625601', zones), 'big');
  assert.equal(zoneByPincode('625602', zones), 'small');
  assert.equal(zoneByPincode('625531', zones), null);
  assert.equal(zoneByPincode('abc', zones), null);
});

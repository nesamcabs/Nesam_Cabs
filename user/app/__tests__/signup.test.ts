import { buildNewCustomerDoc } from '../src/services/userService';

// Spec page 20: a customer is captured by name and mobile, with an optional e-mail.
describe('customer signup', () => {
  it('stores the name, verified mobile and optional e-mail — nothing else is collected', () => {
    const d = buildNewCustomerDoc('uid1', '+919876543210', { name: ' Priya Raman ', email: '' });
    expect(d).toMatchObject({ uid: 'uid1', name: 'Priya Raman', phoneE164: '+919876543210', email: '', role: 'customer', status: 'Approved', walletBalance: 0 });
    // Photo and emergency contact are added later, from the profile.
    expect(d.photoUrl).toBe('');
    expect(d.emergencyContact).toBe('');
  });

  it('normalises an e-mail that was given', () => {
    expect(buildNewCustomerDoc('u', '+919876543210', { name: 'A B', email: ' Priya@Example.com ' }).email).toBe('priya@example.com');
  });
});

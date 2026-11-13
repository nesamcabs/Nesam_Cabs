import { mapBooking } from '../src/services/driverService';
import { mapsDirections, mapsTour } from '../src/utils/geo';

const stops = [
  { name: 'Madurai', address: 'Madurai, Tamil Nadu', lat: 9.9252, lng: 78.1198 },
  { name: 'Trichy', address: 'Trichy, Tamil Nadu', lat: 10.7905, lng: 78.7047 },
];
const booking = (over: Record<string, unknown> = {}) => ({
  status: 'Assigned', pickup: 'Theni', pickupAddress: 'Theni, Tamil Nadu', pickupLat: 10.0104, pickupLng: 77.4768,
  drop: 'Theni', dropAddress: 'Theni, Tamil Nadu', dropLat: 10.0104, dropLng: 77.4768, service: 'Multicity', tripType: 'Round Trip', fare: 9000, ...over,
});

describe('Multicity trip on the driver app', () => {
  it('keeps the tour cities, in order, with their coordinates', () => {
    const t = mapBooking('b1', booking({ stops }));
    expect(t.via).toEqual(['Madurai', 'Trichy']);
    expect(t.viaPlaces).toEqual([
      { address: 'Madurai, Tamil Nadu', lat: 9.9252, lng: 78.1198 },
      { address: 'Trichy, Tamil Nadu', lat: 10.7905, lng: 78.7047 },
    ]);
  });

  it('a one-way trip has no tour cities', () => {
    const t = mapBooking('b2', booking({ service: 'One Way', tripType: 'One Way' }));
    expect(t.via).toEqual([]);
    expect(t.viaPlaces).toEqual([]);
  });

  it('navigation passes through every city, in order, to the final drop', () => {
    const t = mapBooking('b3', booking({ stops }));
    const url = decodeURIComponent(mapsTour(t));
    expect(url).toContain('destination=10.0104,77.4768');
    expect(url).toContain('waypoints=9.9252,78.1198|10.7905,78.7047');
  });

  it('falls back to the plain drop route when a city has no coordinates, or there are no cities', () => {
    const noCoords = mapBooking('b4', booking({ stops: [{ name: 'Madurai' }, stops[1]] }));
    expect(mapsTour(noCoords)).toBe(mapsDirections(noCoords.drop));
    const plain = mapBooking('b5', booking());
    expect(mapsTour(plain)).toBe(mapsDirections(plain.drop));
  });
});

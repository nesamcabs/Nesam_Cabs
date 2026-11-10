// Popular corridors shown in the side menu and offered as one-tap routes (the website's /routes pages).
import type { GeoPlace } from '../types';

const place = (id: string, name: string, address: string, lat: number, lng: number): GeoPlace => ({ id, name, address, lat, lng, type: 'other' });

export interface RouteCorridor {
  slug: string;
  origin: string;
  destination: string;
  pickup: GeoPlace;
  drop: GeoPlace;
}

export const ROUTE_CORRIDORS: RouteCorridor[] = [
  { slug: 'chennai-to-pondicherry', origin: 'Chennai', destination: 'Pondicherry', pickup: place('p-chn', 'Chennai Central', 'Chennai, Tamil Nadu', 13.0827, 80.2707), drop: place('d-pnd', 'Pondicherry White Town', 'Puducherry', 11.9416, 79.8083) },
  { slug: 'chennai-to-bangalore', origin: 'Chennai', destination: 'Bangalore', pickup: place('p-chn2', 'Chennai Koyambedu', 'Chennai, Tamil Nadu', 13.0694, 80.1948), drop: place('d-blr', 'Bangalore Majestic', 'Bengaluru, Karnataka', 12.9767, 77.5713) },
  { slug: 'coimbatore-to-ooty', origin: 'Coimbatore', destination: 'Ooty', pickup: place('p-cbe', 'Coimbatore Gandhipuram', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558), drop: place('d-ooty', 'Ooty Charring Cross', 'Udhagamandalam, Tamil Nadu', 11.4102, 76.695) },
  { slug: 'madurai-to-rameshwaram', origin: 'Madurai', destination: 'Rameshwaram', pickup: place('p-mdu', 'Madurai Junction', 'Madurai, Tamil Nadu', 9.9252, 78.1198), drop: place('d-rsm', 'Rameshwaram Temple', 'Rameswaram, Tamil Nadu', 9.2876, 79.3129) },
  { slug: 'bangalore-to-mysore', origin: 'Bangalore', destination: 'Mysore', pickup: place('p-blr3', 'Bangalore Electronic City', 'Bengaluru, Karnataka', 12.8399, 77.677), drop: place('d-mys', 'Mysore Palace', 'Mysuru, Karnataka', 12.3051, 76.6551) },
  { slug: 'trichy-to-thanjavur', origin: 'Trichy', destination: 'Thanjavur', pickup: place('p-trz', 'Trichy Central', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047), drop: place('d-tjv', 'Thanjavur Big Temple', 'Thanjavur, Tamil Nadu', 10.787, 79.1378) },
  { slug: 'salem-to-yercaud', origin: 'Salem', destination: 'Yercaud', pickup: place('p-slm', 'Salem Junction', 'Salem, Tamil Nadu', 11.6643, 78.146), drop: place('d-ycd', 'Yercaud Lake', 'Yercaud, Tamil Nadu', 11.7753, 78.2093) },
  { slug: 'chennai-to-tirupati', origin: 'Chennai', destination: 'Tirupati', pickup: place('p-chn3', 'Chennai Koyambedu', 'Chennai, Tamil Nadu', 13.0694, 80.1948), drop: place('d-tpt', 'Tirupati Balaji', 'Tirumala, Andhra Pradesh', 13.6833, 79.3472) },
];

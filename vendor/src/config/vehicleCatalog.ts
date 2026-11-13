// The Indian passenger-vehicle market, for the Add vehicle form: every make a fleet is likely to run, its models, the NESAM
// category each one belongs to and the passenger seats it is sold with. Choosing a make and model fills the category and the
// passenger capacity, so a vendor never has to guess either.
//
// Seats are PASSENGER seats, driver excluded ("4" = a 4+1 car), as dispatch reads them (functions/src/domain/eligibility.ts).
// The category is also settled by seats, the way dispatch classes a vehicle: 6 or more passengers is an SUV / MPV tier,
// fewer than 6 is a hatchback or sedan tier. So a 5-seat crossover such as a Creta is the Sedan tier and a 7-seat Ertiga is
// SUV, whatever they are marketed as, and a vehicle can never be offered duties of a bigger class than it can carry.
import { FLEET_CATEGORIES } from './constants';

export type VehicleCategory = (typeof FLEET_CATEGORIES)[number];

export interface CatalogModel {
  name: string;
  /** The category the model is marketed in; `categoryFor` adjusts it by the seats chosen. */
  category: VehicleCategory;
  /** Passenger seats it is sold with (driver excluded), smallest first. */
  seats: number[];
}

const H: VehicleCategory = 'Hatchback';
const S: VehicleCategory = 'Sedan';
const U: VehicleCategory = 'SUV';
const P: VehicleCategory = 'Premium SUV';
const T: VehicleCategory = 'Tempo Traveller';
const M: VehicleCategory = 'Mini Bus';
const B: VehicleCategory = 'Bus';

const m = (name: string, category: VehicleCategory, ...seats: number[]): CatalogModel => ({ name, category, seats });

export const VEHICLE_CATALOG: Record<string, CatalogModel[]> = {
  'Maruti Suzuki': [
    m('Alto 800', H, 4), m('Alto K10', H, 4), m('S-Presso', H, 4), m('Wagon R', H, 4), m('Celerio', H, 4), m('Swift', H, 4),
    m('Ignis', H, 4), m('Baleno', H, 4), m('Fronx', U, 4), m('Dzire', S, 4), m('Ciaz', S, 4), m('Eeco', H, 4, 6),
    m('Omni', H, 4, 6), m('Ertiga', U, 6, 7), m('XL6', U, 5, 6), m('Brezza', U, 4), m('Grand Vitara', U, 4), m('Jimny', U, 3),
    m('Invicto', P, 6, 7), m('Zen', H, 4), m('Estilo', H, 4), m('A-Star', H, 4), m('Ritz', H, 4), m('SX4', S, 4),
  ],
  Hyundai: [
    m('Eon', H, 4), m('Santro', H, 4), m('i10', H, 4), m('Grand i10', H, 4), m('Grand i10 Nios', H, 4), m('i20', H, 4),
    m('Xcent', S, 4), m('Aura', S, 4), m('Verna', S, 4), m('Elantra', S, 4), m('Exter', U, 4), m('Venue', U, 4),
    m('Creta', U, 4), m('Creta Electric', U, 4), m('Alcazar', U, 5, 6), m('Tucson', P, 4), m('Kona Electric', U, 4), m('Ioniq 5', P, 4),
  ],
  Tata: [
    m('Indica', H, 4), m('Indica Vista', H, 4), m('Tiago', H, 4), m('Tiago EV', H, 4), m('Altroz', H, 4), m('Indigo', S, 4),
    m('Indigo eCS', S, 4), m('Zest', S, 4), m('Tigor', S, 4), m('Tigor EV', S, 4), m('Punch', U, 4), m('Punch EV', U, 4),
    m('Nexon', U, 4), m('Nexon EV', U, 4), m('Curvv', U, 4), m('Harrier', P, 4), m('Safari', U, 5, 6), m('Sumo', U, 6, 8, 9),
    m('Winger', T, 9, 12, 13), m('Starbus', M, 20, 26, 32), m('Marcopolo', B, 40, 45, 52),
  ],
  Mahindra: [
    m('KUV100', H, 4, 5), m('Verito', S, 4), m('Logan', S, 4), m('Bolero', U, 6, 7), m('Bolero Neo', U, 6, 7), m('Scorpio', U, 6, 7),
    m('Scorpio-N', U, 6, 7), m('XUV300', U, 4), m('XUV 3XO', U, 4), m('XUV400', U, 4), m('XUV500', U, 5, 6), m('XUV700', U, 5, 6),
    m('Thar', U, 3, 4), m('Marazzo', U, 6, 7), m('Xylo', U, 6, 7, 8), m('TUV300', U, 6, 7), m('Quanto', U, 6, 7), m('BE 6', U, 4),
    m('XEV 9e', U, 4),
  ],
  Toyota: [
    m('Etios Liva', H, 4), m('Etios', S, 4), m('Glanza', H, 4), m('Yaris', S, 4), m('Corolla Altis', S, 4), m('Camry', S, 4),
    m('Urban Cruiser Hyryder', U, 4), m('Urban Cruiser Taisor', U, 4), m('Rumion', U, 6, 7), m('Innova', U, 6, 7), m('Innova Crysta', P, 6, 7),
    m('Innova Hycross', P, 6, 7), m('Qualis', U, 6, 9), m('Fortuner', P, 6, 7), m('Legender', P, 6), m('Hilux', U, 4),
    m('Vellfire', P, 6), m('Land Cruiser', P, 6, 7), m('Hiace', T, 9, 12),
  ],
  Honda: [
    m('Brio', H, 4), m('Jazz', H, 4), m('Amaze', S, 4), m('City', S, 4), m('Civic', S, 4), m('Accord', S, 4), m('WR-V', U, 4),
    m('Elevate', U, 4), m('BR-V', U, 6, 7), m('Mobilio', U, 6, 7), m('CR-V', P, 4, 6),
  ],
  Kia: [m('Sonet', U, 4), m('Seltos', U, 4), m('Syros', U, 4), m('Carens', U, 5, 6), m('Carnival', P, 6, 7), m('EV6', P, 4)],
  Renault: [
    m('Kwid', H, 4), m('Pulse', H, 4), m('Scala', S, 4), m('Fluence', S, 4), m('Triber', U, 6), m('Kiger', U, 4), m('Duster', U, 4),
    m('Captur', U, 4), m('Lodgy', U, 6, 7),
  ],
  Nissan: [m('Micra', H, 4), m('Sunny', S, 4), m('Magnite', U, 4), m('Kicks', U, 4), m('Terrano', U, 4), m('Evalia', U, 6, 7)],
  Datsun: [m('Go', H, 4), m('Redi-Go', H, 4), m('Go+', U, 6)],
  Skoda: [
    m('Rapid', S, 4), m('Octavia', S, 4), m('Slavia', S, 4), m('Laura', S, 4), m('Superb', P, 4), m('Kushaq', U, 4), m('Kodiaq', P, 6),
  ],
  Volkswagen: [m('Polo', H, 4), m('Ameo', S, 4), m('Vento', S, 4), m('Virtus', S, 4), m('Taigun', U, 4), m('Tiguan', P, 4)],
  MG: [
    m('Comet EV', H, 3), m('Astor', U, 4), m('ZS EV', U, 4), m('Windsor EV', U, 4), m('Hector', U, 4, 5), m('Hector Plus', U, 5, 6),
    m('Gloster', P, 5, 6),
  ],
  Ford: [
    m('Figo', H, 4), m('Freestyle', H, 4), m('Ikon', S, 4), m('Fiesta', S, 4), m('Classic', S, 4), m('Aspire', S, 4), m('EcoSport', U, 4),
    m('Endeavour', P, 6, 7),
  ],
  Chevrolet: [
    m('Spark', H, 4), m('Beat', H, 4), m('Aveo', S, 4), m('Sail', S, 4), m('Cruze', S, 4), m('Enjoy', U, 6, 7), m('Tavera', U, 6, 7, 8, 9),
  ],
  Fiat: [m('Punto', H, 4), m('Palio', H, 4), m('Linea', S, 4)],
  'Hindustan Motors': [m('Ambassador', S, 4)],
  'Force Motors': [
    m('Traveller', T, 9, 12, 14, 17), m('Urbania', T, 10, 13, 14, 17), m('Trax', T, 8, 10, 12), m('Gurkha', U, 3, 4, 6),
  ],
  'Ashok Leyland': [m('Stile', U, 6, 7, 8), m('Lynx', M, 20, 26, 32), m('Sunshine', M, 26, 32), m('Oyster', B, 32, 40), m('Viking', B, 40, 52)],
  Eicher: [m('Skyline Pro', M, 26, 32), m('Starline', B, 40, 52)],
  'SML Isuzu': [m('Samrat', M, 20, 26), m('Executive', B, 26, 32, 40)],
  'Swaraj Mazda': [m('Bus', M, 20, 26, 32)],
  BharatBenz: [m('Staff / Tourist Bus', B, 35, 40, 45, 52)],
  Volvo: [m('S90', S, 4), m('XC60', P, 4), m('XC90', P, 6), m('B9R Coach', B, 40, 45), m('9400 Coach', B, 40, 45, 52)],
  Isuzu: [m('D-Max V-Cross', U, 4), m('MU-X', P, 6)],
  Mitsubishi: [m('Lancer', S, 4), m('Outlander', U, 6), m('Pajero Sport', P, 6, 7)],
  Jeep: [m('Compass', U, 4), m('Meridian', U, 5, 6), m('Wrangler', U, 3, 4)],
  Citroen: [m('C3', H, 4), m('eC3', H, 4), m('Basalt', U, 4), m('C3 Aircross', U, 4, 6)],
  BYD: [m('e6', U, 6), m('eMAX 7', U, 6, 7), m('Atto 3', U, 4), m('Seal', S, 4)],
  'Mercedes-Benz': [
    m('A-Class Limousine', S, 4), m('C-Class', S, 4), m('E-Class', S, 4), m('S-Class', S, 4), m('GLA', U, 4), m('GLC', U, 4), m('GLE', P, 4, 6),
    m('GLS', P, 6), m('V-Class', P, 6, 7), m('Sprinter', T, 12, 14, 17, 20),
  ],
  BMW: [m('3 Series', S, 4), m('5 Series', S, 4), m('7 Series', S, 4), m('X1', U, 4), m('X3', U, 4), m('X5', P, 4, 6), m('X7', P, 6)],
  Audi: [m('A3', S, 4), m('A4', S, 4), m('A6', S, 4), m('Q3', U, 4), m('Q5', U, 4), m('Q7', P, 6), m('Q8', P, 4)],
  Lexus: [m('ES', S, 4), m('RX', P, 4), m('LX', P, 6, 7), m('LM', P, 3, 6)],
  'Land Rover': [m('Range Rover Evoque', P, 4), m('Range Rover Sport', P, 4), m('Range Rover', P, 4, 6), m('Defender', P, 5, 6), m('Discovery', P, 6)],
  Jaguar: [m('XF', S, 4), m('XJ', S, 4), m('F-Pace', U, 4)],
  Mini: [m('Cooper', H, 3), m('Countryman', U, 4)],
};

/** The make shown last: anything not in the list above (a niche make, an imported or converted vehicle). */
export const OTHER_MAKE = 'Other (not listed)';
export const OTHER_MODEL = 'Other (not listed)';

export const MAKES: string[] = [...Object.keys(VEHICLE_CATALOG).sort((a, b) => a.localeCompare(b)), OTHER_MAKE];

/** Passenger capacities offered for a vehicle that is not in the catalogue. */
export const GENERIC_SEATS: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 17, 20, 22, 26, 30, 32, 35, 40, 45, 52, 55];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, '');

/** The catalogue spelling of a make typed or stored in any case ("toyota " → "Toyota"); '' when it is not in the catalogue. */
export function matchMake(make: string): string {
  const n = norm(make);
  if (!n) return '';
  return Object.keys(VEHICLE_CATALOG).find((k) => norm(k) === n) ?? '';
}

export const modelsOf = (make: string): CatalogModel[] => VEHICLE_CATALOG[make] ?? [];

export function matchModel(make: string, model: string): CatalogModel | undefined {
  const n = norm(model);
  return n ? modelsOf(make).find((x) => norm(x.name) === n) : undefined;
}

/** The category a model falls in for the passenger seats chosen (see the note at the top about seats deciding the tier). */
export function categoryFor(model: Pick<CatalogModel, 'category'>, seats: number): VehicleCategory {
  const c = model.category;
  if (c === 'Tempo Traveller' || c === 'Mini Bus' || c === 'Bus') return c;
  if (seats >= 6) return c === 'Premium SUV' ? 'Premium SUV' : 'SUV';
  return c === 'Hatchback' ? 'Hatchback' : 'Sedan';
}

/** The seat count preselected when a model is chosen: its usual configuration (the smallest it is sold with). */
export const defaultSeats = (model: CatalogModel): number => model.seats[0] ?? 4;

/** Every category the market has, for a vehicle that is not in the catalogue. */
export const ALL_CATEGORIES: readonly VehicleCategory[] = FLEET_CATEGORIES;

import { describe, expect, it } from 'vitest';
import type { GeoPlace } from '@core/types';
import { directory, flattenTree, groupByRegion, regionOf, searchDirectory, selectable, stateNear, withoutListed, type PlaceNode } from './model';

const live = (id: string, name: string, address: string, lat: number, lng: number): GeoPlace => ({ id, name, address, lat, lng, type: 'other' });
const titles = (nodes: PlaceNode[] = []) => nodes.map((n) => n.title);
const visible = (query: string) => {
  const r = searchDirectory(query);
  return flattenTree(r.nodes, (id) => r.open.has(id));
};

describe('directory', () => {
  it('lists states, then districts, then towns, with unique ids and Indian coordinates', () => {
    const states = directory();
    expect(titles(states)).toEqual(['Tamil Nadu', 'Puducherry', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana']);
    expect(states[0]!.children).toHaveLength(38);
    const places = selectable(states);
    expect(new Set(places.map((p) => p.place!.id)).size).toBe(places.length);
    for (const p of places) {
      expect(p.place!.lat).toBeGreaterThan(8);
      expect(p.place!.lat).toBeLessThan(20);
      expect(p.place!.lng).toBeGreaterThan(74);
      expect(p.place!.lng).toBeLessThan(85);
    }
  });

  it('gives an area an address that names its city', () => {
    const trichy = selectable(directory()).find((p) => p.title === 'Trichy')!;
    expect(trichy.place!.address).toBe('Tiruchirappalli, Tamil Nadu');
    const area = trichy.children!.find((c) => c.title === 'Thillai Nagar')!;
    expect(area.place!.address).toBe('Trichy, Tiruchirappalli, Tamil Nadu');
    // The name alone must still say which city.
    expect(area.place!.name).toBe('Thillai Nagar, Trichy');
    expect(trichy.children!.find((c) => c.title === 'Trichy Junction')!.place!.name).toBe('Trichy Junction');
  });

  it('writes a hill station’s pincode into its address, where the server looks for it', () => {
    const places = selectable(directory());
    for (const [name, pin] of [['Ooty', '643001'], ['Kodaikanal', '624101'], ['Munnar', '685612'], ['Yercaud', '636601']] as const) {
      expect(places.find((p) => p.title === name)!.place!.address).toMatch(new RegExp(` ${pin}$`));
    }
    expect(places.find((p) => p.title === 'Madurai' && p.kind === 'main')!.place!.address).not.toMatch(/\d{6}/);
  });

  it('marks airports so the airport rules recognise them', () => {
    const airports = selectable(directory()).filter((p) => p.kind === 'airport');
    expect(airports.length).toBeGreaterThan(10);
    expect(airports.every((p) => p.place && 'type' in p.place && p.place.type === 'airport')).toBe(true);
  });
});

describe('searching the directory', () => {
  it('shows a city under its district and state, with its areas open', () => {
    const rows = visible('trichy');
    expect(rows.slice(0, 3).map((r) => [r.node.kind, r.node.title, r.depth])).toEqual([
      ['state', 'Tamil Nadu', 0],
      ['district', 'Tiruchirappalli', 1],
      ['main', 'Trichy', 2],
    ]);
    expect(rows.some((r) => r.depth === 3 && r.node.title === 'Central Bus Stand')).toBe(true);
  });

  it('understands "city + kind" and other spellings', () => {
    expect(visible('trichy bus').filter((r) => r.node.kind === 'bus').map((r) => r.node.title)).toEqual(expect.arrayContaining(['Central Bus Stand', 'Chathiram Bus Stand']));
    expect(visible('kovai').some((r) => r.node.title === 'Coimbatore' && r.node.place)).toBe(true);
    expect(visible('t nagar').some((r) => r.node.title === 'T. Nagar')).toBe(true);
  });

  it('keeps cities closed while the text could mean several', () => {
    const rows = visible('tri');
    const mains = rows.filter((r) => r.node.title === 'Trichy' || r.node.title === 'Trivandrum');
    expect(mains).toHaveLength(2);
    expect(mains.every((r) => r.expandable && !r.open)).toBe(true);
  });

  it('lists a district’s towns when the district is typed', () => {
    const rows = visible('theni');
    expect(rows.map((r) => r.node.title)).toEqual(expect.arrayContaining(['Theni', 'Periyakulam', 'Cumbum']));
  });

  it('opens a state to its districts, not further', () => {
    const rows = visible('kerala');
    expect(rows[0]!.node.title).toBe('Kerala');
    expect(rows.slice(1).every((r) => r.node.kind === 'district' && !r.open)).toBe(true);
  });

  it('stays quiet for one letter or nonsense', () => {
    expect(searchDirectory('t').nodes).toEqual([]);
    expect(searchDirectory('qqqqzz').nodes).toEqual([]);
  });
});

describe('live results', () => {
  it('reads the state and district from the address', () => {
    expect(regionOf(live('a', 'Hotel', '12, Salem Main Road, Gandhipuram, Coimbatore, Tamil Nadu 641012, India', 11.02, 76.97))).toMatchObject({ stateName: 'Tamil Nadu', districtName: 'Coimbatore' });
  });

  it('falls back to the closest town when the address names none', () => {
    expect(regionOf(live('a', 'Farm', 'Somewhere', 10.9617, 79.3881))).toMatchObject({ stateName: 'Tamil Nadu', districtName: 'Thanjavur' });
  });

  it('keeps places outside the directory under the state they name', () => {
    expect(regionOf(live('a', 'Gateway', 'Colaba, Mumbai, Maharashtra, India', 18.92, 72.83))).toMatchObject({ stateName: 'Maharashtra', districtName: null });
  });

  it('groups by state and district in the order received', () => {
    const tree = groupByRegion([
      live('1', 'A', 'Kochi, Kerala', 9.97, 76.28),
      live('2', 'B', 'Madurai, Tamil Nadu', 9.92, 78.11),
      live('3', 'C', 'Ernakulam, Kerala', 9.98, 76.29),
    ]);
    expect(titles(tree.nodes)).toEqual(['Kerala', 'Tamil Nadu']);
    expect(titles(tree.nodes[0]!.children![0]!.children)).toEqual(['A', 'C']);
  });

  it('drops a city the directory already shows, but keeps places in it', () => {
    const listed = searchDirectory('trichy').places;
    const kept = withoutListed(
      [live('city-trichy', 'Trichy', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047), live('g1', 'Hotel Trichy Palace', 'Trichy, Tamil Nadu', 10.8, 78.69)],
      listed,
    );
    expect(kept.map((p) => p.id)).toEqual(['g1']);
  });
});

describe('tree lines', () => {
  it('continues a line only while that level has more rows', () => {
    const node = (id: string, children?: PlaceNode[]): PlaceNode => ({ id, kind: 'town', title: id, children });
    const rows = flattenTree([node('s', [node('d1', [node('a')]), node('d2')])], () => true);
    expect(rows.map((r) => [r.node.id, r.depth, r.guides, r.last])).toEqual([
      ['s', 0, [], true],
      ['d1', 1, [], false],
      ['a', 2, [true], true],
      ['d2', 1, [], true],
    ]);
  });
});

describe('browse tab', () => {
  it('starts on the rider’s state, or Tamil Nadu', () => {
    expect(stateNear({ lat: 12.97, lng: 77.59 })).toBe('ka');
    expect(stateNear(null)).toBe('tn');
  });
});

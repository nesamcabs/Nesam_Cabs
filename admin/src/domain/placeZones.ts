/**
 * Which areas / towns / zones sit INSIDE which city or district. Used by:
 *  - the admin "Area / zone" pickers (every listed city shows its areas), and
 *  - the booking server (functions/src/domain/placeZones.ts is a byte-for-byte copy: keep both in sync),
 *    so a rule for a city or district also covers every area inside it. Pausing Erode pauses Gobichettipalayam too;
 *    pausing only Gobichettipalayam leaves the rest of Erode open.
 *
 * Keys are lower-case city / district names. Names must be distinctive enough to find in an address.
 * Any area that is not listed can still be typed in the admin picker and saved; it then matches by its own name.
 */
export const ZONES_BY_CITY: Record<string, string[]> = {
  // Greater Chennai Corporation: 15 zones.
  chennai: ["Thiruvottiyur", "Manali", "Madhavaram", "Tondiarpet", "Royapuram", "Thiru Vi Ka Nagar", "Ambattur", "Anna Nagar", "Teynampet", "Kodambakkam", "Valasaravakkam", "Alandur", "Adyar", "Perungudi", "Sholinganallur"],
  // Coimbatore City Municipal Corporation: 5 zones, then the rest of the district.
  coimbatore: ["Central", "East", "North", "South", "West", "Pollachi", "Mettupalayam", "Sulur", "Annur", "Valparai", "Kinathukadavu", "Madukkarai", "Thondamuthur", "Karamadai", "Singanallur", "Vadavalli", "Saravanampatti", "Peelamedu"],
  // Salem City Municipal Corporation: 4 zones, then the rest of the district.
  salem: ["Ammapet", "Hasthampatti", "Kondalampatti", "Suramangalam", "Attur", "Mettur", "Omalur", "Edappadi", "Sankagiri", "Yercaud", "Vazhapadi", "Gangavalli", "Mecheri", "Thammampatti"],
  // Bruhat Bengaluru Mahanagara Palike: 8 zones.
  bengaluru: ["Bommanahalli", "Dasarahalli", "East", "Mahadevapura", "Rajarajeshwari Nagar", "South", "West", "Yelahanka"],
  // Greater Hyderabad Municipal Corporation: 6 zones.
  hyderabad: ["Charminar", "Kukatpally", "Khairatabad", "LB Nagar", "Secunderabad", "Serilingampally"],

  // Tamil Nadu districts: taluk headquarters and the towns people book from.
  ariyalur: ["Jayankondam", "Udayarpalayam", "Sendurai", "Andimadam"],
  chengalpattu: ["Guduvanchery", "Vandalur", "Maraimalai Nagar", "Madurantakam", "Thirukalukundram", "Cheyyur", "Singaperumal Koil", "Kelambakkam", "Mahabalipuram", "Tiruporur"],
  cuddalore: ["Chidambaram", "Neyveli", "Panruti", "Virudhachalam", "Kurinjipadi", "Bhuvanagiri", "Vadalur", "Kattumannarkoil", "Parangipettai"],
  dharmapuri: ["Harur", "Palacode", "Pennagaram", "Karimangalam", "Pappireddipatti", "Hogenakkal"],
  dindigul: ["Palani", "Kodaikanal", "Oddanchatram", "Vedasandur", "Natham", "Nilakottai", "Batlagundu", "Athoor"],
  erode: ["Gobichettipalayam", "Bhavani", "Perundurai", "Sathyamangalam", "Anthiyur", "Kodumudi", "Modakurichi", "Chennimalai", "Nambiyur", "Thalavadi", "Kavindapadi", "Punjai Puliyampatti"],
  kallakurichi: ["Sankarapuram", "Chinnasalem", "Ulundurpet", "Tirukoilur", "Thiyagadurgam", "Kalvarayan Hills"],
  kanchipuram: ["Sriperumbudur", "Walajabad", "Uthiramerur", "Kundrathur", "Oragadam", "Sunguvarchatram"],
  kanyakumari: ["Nagercoil", "Marthandam", "Thuckalay", "Colachel", "Kuzhithurai", "Padmanabhapuram", "Thovalai", "Vilavancode"],
  karur: ["Kulithalai", "Aravakurichi", "Krishnarayapuram", "Pugalur", "Kadavur", "Manmangalam"],
  krishnagiri: ["Hosur", "Denkanikottai", "Pochampalli", "Uthangarai", "Shoolagiri", "Bargur", "Veppanapalli"],
  madurai: ["Melur", "Thirumangalam", "Usilampatti", "Vadipatti", "Peraiyur", "Sholavandan", "Alanganallur", "Thiruparankundram", "Kalligudi", "Samayanallur"],
  mayiladuthurai: ["Sirkazhi", "Tharangambadi", "Kuthalam", "Sembanarkoil", "Poompuhar"],
  nagapattinam: ["Velankanni", "Vedaranyam", "Kilvelur", "Thirukkuvalai", "Nagore"],
  namakkal: ["Tiruchengode", "Rasipuram", "Paramathi Velur", "Kumarapalayam", "Sendamangalam", "Mohanur", "Kolli Hills", "Pallipalayam"],
  nilgiris: ["Ooty", "Coonoor", "Kotagiri", "Gudalur", "Pandalur", "Wellington", "Udhagamandalam", "Aruvankadu"],
  perambalur: ["Veppanthattai", "Kunnam", "Alathur", "Labbaikudikadu"],
  pudukkottai: ["Aranthangi", "Alangudi", "Gandarvakottai", "Illuppur", "Karambakudi", "Kulathur", "Viralimalai", "Avudaiyarkoil", "Ponnamaravathi", "Thirumayam"],
  ramanathapuram: ["Rameswaram", "Paramakudi", "Mudukulathur", "Kamuthi", "Kadaladi", "Tiruvadanai", "Thondi", "Devipattinam", "Keelakarai", "Dhanushkodi", "Mandapam"],
  ranipet: ["Arakkonam", "Arcot", "Walajapet", "Sholinghur", "Nemili", "Kalavai", "Melvisharam"],
  sivaganga: ["Karaikudi", "Devakottai", "Manamadurai", "Ilayangudi", "Kalaiyarkovil", "Singampunari", "Thiruppuvanam", "Kanadukathan"],
  tenkasi: ["Courtallam", "Sankarankovil", "Shenkottai", "Puliyangudi", "Kadayanallur", "Alangulam", "Sivagiri", "Surandai", "Vasudevanallur"],
  thanjavur: ["Kumbakonam", "Pattukkottai", "Papanasam", "Orathanadu", "Peravurani", "Thiruvaiyaru", "Thiruvidaimarudur", "Budalur", "Swamimalai"],
  theni: ["Periyakulam", "Bodinayakanur", "Cumbum", "Uthamapalayam", "Andipatti", "Chinnamanur", "Suruli"],
  thoothukudi: ["Tiruchendur", "Kovilpatti", "Srivaikuntam", "Ettayapuram", "Kayathar", "Sathankulam", "Ottapidaram", "Vilathikulam", "Udangudi", "Kulasekarapattinam"],
  tiruchirappalli: ["Srirangam", "Lalgudi", "Musiri", "Manapparai", "Thuraiyur", "Thiruverumbur", "Manachanallur", "Marungapuri", "Thottiyam", "Samayapuram"],
  tirunelveli: ["Palayamkottai", "Ambasamudram", "Nanguneri", "Radhapuram", "Cheranmahadevi", "Manur", "Thisayanvilai", "Kalakkad", "Vikramasingapuram"],
  tirupathur: ["Vaniyambadi", "Ambur", "Natrampalli", "Jolarpet", "Alangayam"],
  tiruppur: ["Avinashi", "Palladam", "Dharapuram", "Udumalaipettai", "Kangeyam", "Madathukulam", "Uthukuli", "Perumanallur", "Mulanur"],
  tiruvallur: ["Ponneri", "Gummidipoondi", "Tiruttani", "Uthukottai", "Pulicat", "Pallipattu", "Minjur", "Sholavaram"],
  tiruvannamalai: ["Arani", "Cheyyar", "Polur", "Vandavasi", "Chengam", "Thandrampet", "Kalasapakkam", "Jamunamarathur", "Kilpennathur"],
  tiruvarur: ["Mannargudi", "Thiruthuraipoondi", "Nannilam", "Kodavasal", "Needamangalam", "Valangaiman", "Koothanallur", "Muthupettai"],
  vellore: ["Katpadi", "Gudiyatham", "Anaicut", "Pernambut", "Kaniyambadi", "Sathuvachari", "Bagayam", "Virinjipuram", "Odugathur"],
  viluppuram: ["Tindivanam", "Gingee", "Vikravandi", "Vanur", "Marakkanam", "Kandamangalam", "Melmalayanur", "Mailam"],
  virudhunagar: ["Sivakasi", "Rajapalayam", "Srivilliputhur", "Aruppukottai", "Sattur", "Tiruchuli", "Kariapatti", "Watrap", "Vembakottai"],
};

const norm = (v?: string) => (v ?? "").trim().toLocaleLowerCase();
/** Directions, and names shared with well-known places elsewhere (Manali, Himachal): never used to guess which city an address belongs to. */
const GENERIC = new Set(["central", "east", "west", "north", "south", "manali", "wellington", "cumbum"]);

/** The areas inside a city / district. */
export const zonesOf = (city?: string): string[] => ZONES_BY_CITY[norm(city)] ?? [];

/** Is `area` listed inside `city`? */
export const isInside = (city?: string, area?: string): boolean => !!norm(area) && zonesOf(city).some((z) => norm(z) === norm(area));

/** The district / city that lists `name` as one of its areas (e.g. Gobichettipalayam → erode), if any. */
export function parentOf(name?: string): string | undefined {
  const n = norm(name);
  if (!n || GENERIC.has(n)) return undefined;
  return Object.keys(ZONES_BY_CITY).find((city) => city !== n && ZONES_BY_CITY[city]!.some((z) => norm(z) === n));
}

/** The distinctive area names inside a city / district, lower-cased (for finding them in an address). */
export const childNames = (city?: string): string[] => zonesOf(city).map(norm).filter((z) => !GENERIC.has(z));

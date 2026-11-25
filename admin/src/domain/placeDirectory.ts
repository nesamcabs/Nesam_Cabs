/**
 * Built-in cities and zones for the "Which location are you managing?" pickers, so they are never
 * empty. Cities and areas saved under Locations are added to these (see Pricing.tsx); rules keep
 * storing the plain names, so a saved "Chennai" and the built-in "Chennai" are the same place.
 *
 * Keys are GST state codes (the same codes the State picker uses). Zones are listed only where the
 * city corporation's official zones are known; any other area is added under Locations.
 */
import { ZONES_BY_CITY, zonesOf } from "./placeZones";
import { DISTRICTS_BY_STATE } from "./pincodeDistricts";

export const CITIES_BY_STATE: Record<string, string[]> = {
  // Tamil Nadu: every district headquarters, plus the towns riders book from most.
  "33": [
    "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram",
    "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai",
    "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
    "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar",
    "Chidambaram", "Coonoor", "Hosur", "Karaikudi", "Kodaikanal", "Kumbakonam", "Mahabalipuram", "Mettupalayam", "Nagercoil", "Ooty",
    "Palani", "Pollachi", "Rameswaram", "Sivakasi", "Velankanni", "Yercaud",
  ],
  "34": ["Puducherry", "Karaikal", "Mahe", "Yanam", "Auroville"],
  "29": [
    "Bengaluru", "Ballari", "Belagavi", "Chikkamagaluru", "Davanagere", "Hassan", "Hubballi", "Kalaburagi", "Madikeri", "Mangaluru",
    "Mysuru", "Shivamogga", "Tumakuru", "Udupi",
  "Hampi", "Gokarna", "Chitradurga", "Bidar", "Vijayapura", "Raichur", "Mandya", "Hosapete", "Karwar", "Dharwad", "Bagalkot", "Chikkaballapur", "Ramanagara", "Sakleshpur"],
  "32": [
    "Thiruvananthapuram", "Alappuzha", "Guruvayur", "Idukki", "Kannur", "Kasaragod", "Kochi", "Kollam", "Kottayam", "Kozhikode",
    "Malappuram", "Munnar", "Palakkad", "Pathanamthitta", "Thrissur", "Wayanad",
  "Kovalam", "Varkala", "Kumarakom", "Thekkady", "Attingal", "Kayamkulam", "Nilambur"],
  "37": [
    "Visakhapatnam", "Anantapur", "Chittoor", "Guntur", "Kadapa", "Kakinada", "Kurnool", "Nellore", "Ongole", "Rajahmundry",
    "Srikalahasti", "Tirupati", "Vijayawada",
  "Eluru", "Machilipatnam", "Tenali", "Vizianagaram", "Srikakulam", "Bhimavaram", "Proddatur", "Hindupur", "Madanapalle", "Puttaparthi", "Dharmavaram", "Amaravati"],
  "36": ["Hyderabad", "Secunderabad", "Karimnagar", "Khammam", "Nizamabad", "Warangal", "Mahabubnagar", "Adilabad", "Nalgonda", "Siddipet", "Ramagundam", "Mancherial", "Suryapet", "Bhadrachalam", "Medak"],
  "27": [
    "Mumbai", "Nagpur", "Pune", "Nashik", "Aurangabad", "Thane", "Kolhapur", "Solapur", "Shirdi", "Lonavala", "Mahabaleshwar", "Satara", "Sangli",
    "Amravati", "Nanded", "Navi Mumbai", "Alibag", "Ratnagiri", "Panvel", "Akola", "Latur", "Jalgaon", "Chandrapur", "Ahmednagar", "Kalyan",
    "Pimpri Chinchwad", "Sindhudurg", "Wardha", "Yavatmal", "Bhandara",
  ],
  "07": ["New Delhi"],
  // Every other state and union territory (GST codes), so a fare set once reaches the whole country.
  "01": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Gulmarg", "Pahalgam", "Katra", "Udhampur", "Sonamarg", "Kupwara"],
  "02": ["Shimla", "Manali", "Dharamshala", "Kullu", "Solan", "Mandi", "Dalhousie", "Kasauli", "Kangra", "Una", "Chamba", "Palampur"],
  "03": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Pathankot", "Hoshiarpur", "Moga", "Firozpur", "Sangrur", "Gurdaspur", "Kapurthala"],
  "04": ["Chandigarh"],
  "05": ["Dehradun", "Haridwar", "Rishikesh", "Nainital", "Mussoorie", "Haldwani", "Roorkee", "Almora", "Pithoragarh", "Ranikhet", "Kotdwar", "Rudrapur", "Ramnagar"],
  "06": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Karnal", "Hisar", "Rohtak", "Sonipat", "Kurukshetra", "Panchkula", "Yamunanagar", "Rewari", "Bhiwani", "Sirsa"],
  "08": ["Jaipur", "Jodhpur", "Udaipur", "Jaisalmer", "Bikaner", "Ajmer", "Pushkar", "Kota", "Mount Abu", "Alwar", "Bharatpur", "Chittorgarh", "Sawai Madhopur", "Bhilwara", "Sikar", "Barmer", "Pali", "Jhunjhunu", "Bundi"],
  "09": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Prayagraj", "Ghaziabad", "Noida", "Greater Noida", "Meerut", "Mathura", "Vrindavan", "Ayodhya", "Gorakhpur", "Bareilly", "Aligarh", "Moradabad", "Jhansi", "Saharanpur", "Firozabad", "Azamgarh"],
  "10": ["Patna", "Gaya", "Bodh Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia", "Arrah", "Nalanda", "Rajgir", "Chapra", "Begusarai", "Katihar", "Munger"],
  "11": ["Gangtok", "Namchi", "Pelling", "Mangan", "Gyalshing"],
  "12": ["Itanagar", "Tawang", "Pasighat", "Ziro", "Bomdila", "Naharlagun"],
  "13": ["Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha"],
  "14": ["Imphal", "Churachandpur", "Thoubal", "Bishnupur"],
  "15": ["Aizawl", "Lunglei", "Champhai", "Serchhip"],
  "16": ["Agartala", "Dharmanagar", "Kailasahar", "Ambassa"],
  "17": ["Shillong", "Tura", "Cherrapunji", "Jowai", "Nongpoh"],
  "18": ["Guwahati", "Dibrugarh", "Silchar", "Jorhat", "Tezpur", "Nagaon", "Tinsukia", "Kaziranga", "Bongaigaon", "Diphu"],
  "19": ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Asansol", "Darjeeling", "Kharagpur", "Digha", "Bardhaman", "Kalimpong", "Jalpaiguri", "Haldia", "Malda", "Cooch Behar", "Bankura"],
  "20": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar", "Hazaribagh", "Giridih", "Ramgarh"],
  "21": ["Bhubaneswar", "Cuttack", "Puri", "Rourkela", "Sambalpur", "Berhampur", "Balasore", "Konark", "Jharsuguda", "Koraput"],
  "22": ["Raipur", "Bilaspur", "Bhilai", "Durg", "Korba", "Raigarh", "Jagdalpur", "Ambikapur"],
  "23": ["Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain", "Sagar", "Satna", "Rewa", "Khajuraho", "Chhindwara", "Ratlam", "Dewas", "Pachmarhi", "Burhanpur"],
  "24": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar", "Jamnagar", "Junagadh", "Dwarka", "Somnath", "Bhuj", "Anand", "Mehsana", "Porbandar", "Kevadia", "Navsari", "Bharuch", "Morbi", "Vapi", "Palanpur"],
  "26": ["Daman", "Diu", "Silvassa"],
  "30": ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Calangute"],
  "31": ["Kavaratti", "Agatti"],
  "35": ["Port Blair", "Havelock Island", "Diglipur"],
  "38": ["Leh", "Kargil", "Diskit"],
};

export { ZONES_BY_CITY };

/**
 * The built-in cities of one state (its GST code), or of every listed state when none is chosen: the towns riders book from most,
 * plus every district of the state as India Post lists it (each has its pincodes, see pincodes.ts).
 */
export function directoryCities(stateCode: string): string[] {
  return stateCode
    ? [...(CITIES_BY_STATE[stateCode] ?? []), ...(DISTRICTS_BY_STATE[stateCode] ?? [])]
    : [...Object.values(CITIES_BY_STATE).flat(), ...Object.values(DISTRICTS_BY_STATE).flat()];
}

/** The built-in zones of one city (matched by name, ignoring case). */
export function directoryZones(city: string): string[] {
  return city ? zonesOf(city) : [];
}

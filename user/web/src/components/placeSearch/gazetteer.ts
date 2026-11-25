// States, their districts, main towns and the places inside the larger cities, for the pickup / drop
// suggestions. Coordinates are from OpenStreetMap (© OpenStreetMap contributors, ODbL); airport
// coordinates match pages/book/content.ts. The first town of a district is its headquarters.
export type PlaceKind = 'main' | 'town' | 'temple' | 'hill' | 'beach' | 'area' | 'bus' | 'train' | 'airport' | 'landmark';

export interface GzPlace {
  n: string;
  k: PlaceKind;
  lat: number;
  lng: number;
  aka?: string[];
  /** Set on hill-station places: the server adds the hill charge by the pincode in the place's address. */
  pin?: string;
  areas?: GzPlace[];
}

export interface GzState {
  id: string;
  name: string;
  districts: { name: string; aka?: string[]; places: GzPlace[] }[];
}

export const GAZETTEER: GzState[] = [
  { id: 'tn', name: 'Tamil Nadu', districts: [
    { name: 'Chennai', aka: ['madras'], places: [
      { n: 'Chennai', k: 'main', lat: 13.0827, lng: 80.2707, aka: ['madras'], areas: [
        { n: 'Chennai International Airport (MAA)', k: 'airport', lat: 12.9941, lng: 80.1709 },
        { n: 'Chennai Central Railway Station', k: 'train', lat: 13.0817, lng: 80.2739 },
        { n: 'Chennai Egmore Station', k: 'train', lat: 13.0777, lng: 80.2613 },
        { n: 'Koyambedu Bus Terminus', k: 'bus', lat: 13.067, lng: 80.2056 },
        { n: 'Kilambakkam Bus Terminus', k: 'bus', lat: 12.8723, lng: 80.0815 },
        { n: 'T. Nagar', k: 'area', lat: 13.0386, lng: 80.2336 },
        { n: 'Anna Nagar', k: 'area', lat: 13.0882, lng: 80.2073 },
        { n: 'Adyar', k: 'area', lat: 13.0064, lng: 80.2578 },
        { n: 'Velachery', k: 'area', lat: 12.9773, lng: 80.2209 },
        { n: 'Guindy', k: 'area', lat: 13.0087, lng: 80.2204 },
        { n: 'Porur', k: 'area', lat: 13.0325, lng: 80.1583 },
        { n: 'Sholinganallur', k: 'area', lat: 12.8981, lng: 80.2307 },
        { n: 'Mylapore', k: 'temple', lat: 13.0316, lng: 80.27 },
        { n: 'Marina Beach', k: 'beach', lat: 13.0533, lng: 80.2833 },
      ] },
    ] },
    { name: 'Coimbatore', aka: ['kovai'], places: [
      { n: 'Coimbatore', k: 'main', lat: 11.0168, lng: 76.9558, aka: ['kovai'], areas: [
        { n: 'Coimbatore International Airport (CJB)', k: 'airport', lat: 11.03, lng: 77.0434 },
        { n: 'Gandhipuram', k: 'bus', lat: 11.0141, lng: 76.9669 },
        { n: 'Ukkadam', k: 'bus', lat: 10.9913, lng: 76.9628 },
        { n: 'Coimbatore Junction', k: 'train', lat: 10.9975, lng: 76.9665 },
        { n: 'Singanallur', k: 'area', lat: 11.0029, lng: 77.0235 },
        { n: 'Peelamedu', k: 'area', lat: 11.0278, lng: 76.9986 },
        { n: 'R.S. Puram', k: 'area', lat: 11.008, lng: 76.9502 },
        { n: 'Saravanampatti', k: 'area', lat: 11.0747, lng: 77.0027 },
        { n: 'Marudhamalai Temple', k: 'temple', lat: 11.0435, lng: 76.8639 },
        { n: 'Isha Yoga Center', k: 'landmark', lat: 10.9773, lng: 76.7375 },
      ] },
      { n: 'Pollachi', k: 'town', lat: 10.6609, lng: 77.0048 },
      { n: 'Mettupalayam', k: 'town', lat: 11.3059, lng: 76.9357 },
      { n: 'Sulur', k: 'town', lat: 11.0269, lng: 77.1259 },
      { n: 'Annur', k: 'town', lat: 11.233, lng: 77.1035 },
      { n: 'Valparai', k: 'hill', pin: '642127', lat: 10.328, lng: 76.9557 },
    ] },
    { name: 'Madurai', places: [
      { n: 'Madurai', k: 'main', lat: 9.9252, lng: 78.1198, areas: [
        { n: 'Madurai Airport (IXM)', k: 'airport', lat: 9.8345, lng: 78.0934 },
        { n: 'Mattuthavani Bus Stand', k: 'bus', lat: 9.9441, lng: 78.156 },
        { n: 'Periyar Bus Stand', k: 'bus', lat: 9.9161, lng: 78.1112 },
        { n: 'Madurai Junction', k: 'train', lat: 9.9196, lng: 78.1102 },
        { n: 'Meenakshi Amman Temple', k: 'temple', lat: 9.9195, lng: 78.1188 },
        { n: 'Anna Nagar', k: 'area', lat: 9.9217, lng: 78.1481 },
        { n: 'K.K. Nagar', k: 'area', lat: 9.9345, lng: 78.1469 },
        { n: 'Thiruparankundram', k: 'temple', lat: 9.8763, lng: 78.0712 },
        { n: 'Alagar Kovil', k: 'temple', lat: 10.0684, lng: 78.2157 },
      ] },
      { n: 'Melur', k: 'town', lat: 10.0309, lng: 78.3376 },
      { n: 'Thirumangalam', k: 'town', lat: 9.8238, lng: 77.9862 },
      { n: 'Usilampatti', k: 'town', lat: 9.9649, lng: 77.7899 },
      { n: 'Vadipatti', k: 'town', lat: 10.0826, lng: 77.9683 },
      { n: 'Peraiyur', k: 'town', lat: 9.7412, lng: 77.7915 },
    ] },
    { name: 'Tiruchirappalli', aka: ['trichy', 'tiruchi', 'tiruchy'], places: [
      { n: 'Trichy', k: 'main', lat: 10.7905, lng: 78.7047, aka: ['tiruchirappalli', 'tiruchirapalli', 'tiruchi'], areas: [
        { n: 'Tiruchirappalli International Airport (TRZ)', k: 'airport', lat: 10.7654, lng: 78.7107 },
        { n: 'Central Bus Stand', k: 'bus', lat: 10.7984, lng: 78.6803 },
        { n: 'Chathiram Bus Stand', k: 'bus', lat: 10.8314, lng: 78.6936 },
        { n: 'Trichy Junction', k: 'train', lat: 10.7943, lng: 78.6853 },
        { n: 'Thillai Nagar', k: 'area', lat: 10.8234, lng: 78.6831 },
        { n: 'Cantonment', k: 'area', lat: 10.8005, lng: 78.6787 },
        { n: 'K.K. Nagar', k: 'area', lat: 10.7564, lng: 78.6911 },
        { n: 'Thiruverumbur', k: 'area', lat: 10.7913, lng: 78.7674 },
        { n: 'Rockfort Temple', k: 'temple', lat: 10.8281, lng: 78.6969 },
        { n: 'Samayapuram Temple', k: 'temple', lat: 10.9204, lng: 78.741 },
      ] },
      { n: 'Srirangam', k: 'temple', lat: 10.8573, lng: 78.6931 },
      { n: 'Manapparai', k: 'town', lat: 10.6082, lng: 78.4231 },
      { n: 'Thuraiyur', k: 'town', lat: 11.1519, lng: 78.5957 },
      { n: 'Musiri', k: 'town', lat: 10.9516, lng: 78.442 },
      { n: 'Lalgudi', k: 'town', lat: 10.8772, lng: 78.8139 },
      { n: 'Thottiyam', k: 'town', lat: 10.9892, lng: 78.3354 },
      { n: 'Thuvakudi', k: 'town', lat: 10.7472, lng: 78.8214 },
    ] },
    { name: 'Salem', places: [
      { n: 'Salem', k: 'main', lat: 11.6643, lng: 78.146, areas: [
        { n: 'Salem Airport (SXV)', k: 'airport', lat: 11.7833, lng: 78.0656 },
        { n: 'Salem New Bus Stand', k: 'bus', lat: 11.6696, lng: 78.1402 },
        { n: 'Salem Junction', k: 'train', lat: 11.6708, lng: 78.1135 },
        { n: 'Hasthampatti', k: 'area', lat: 11.6764, lng: 78.1581 },
        { n: 'Fairlands', k: 'area', lat: 11.6758, lng: 78.1433 },
        { n: 'Ammapet', k: 'area', lat: 11.6588, lng: 78.1809 },
      ] },
      { n: 'Attur', k: 'town', lat: 11.5995, lng: 78.5963 },
      { n: 'Mettur', k: 'town', lat: 11.7902, lng: 77.7981 },
      { n: 'Omalur', k: 'town', lat: 11.7429, lng: 78.0473 },
      { n: 'Sankari', k: 'town', lat: 11.4761, lng: 77.8704 },
      { n: 'Edappadi', k: 'town', lat: 11.5838, lng: 77.8348 },
      { n: 'Yercaud', k: 'hill', pin: '636601', lat: 11.7753, lng: 78.2093 },
    ] },
    { name: 'Tirunelveli', aka: ['nellai'], places: [
      { n: 'Tirunelveli', k: 'main', lat: 8.7139, lng: 77.7567, aka: ['nellai'], areas: [
        { n: 'Tirunelveli New Bus Stand', k: 'bus', lat: 8.7027, lng: 77.7277 },
        { n: 'Tirunelveli Junction', k: 'train', lat: 8.7312, lng: 77.7083 },
        { n: 'Palayamkottai', k: 'area', lat: 8.7199, lng: 77.7371 },
        { n: 'Nellaiappar Temple', k: 'temple', lat: 8.7285, lng: 77.689 },
      ] },
      { n: 'Ambasamudram', k: 'town', lat: 8.7039, lng: 77.4475 },
      { n: 'Valliyur', k: 'town', lat: 8.3768, lng: 77.6143 },
      { n: 'Nanguneri', k: 'town', lat: 8.4893, lng: 77.6597 },
      { n: 'Cheranmahadevi', k: 'town', lat: 8.682, lng: 77.5649 },
    ] },
    { name: 'Erode', places: [
      { n: 'Erode', k: 'main', lat: 11.341, lng: 77.7172, areas: [
        { n: 'Erode Bus Stand', k: 'bus', lat: 11.3471, lng: 77.72 },
        { n: 'Erode Junction', k: 'train', lat: 11.3286, lng: 77.7258 },
        { n: 'Perundurai Road', k: 'area', lat: 11.3348, lng: 77.7069 },
      ] },
      { n: 'Gobichettipalayam', k: 'town', lat: 11.4552, lng: 77.4351, aka: ['gobi'] },
      { n: 'Bhavani', k: 'town', lat: 11.4406, lng: 77.6824 },
      { n: 'Sathyamangalam', k: 'town', lat: 11.5011, lng: 77.2451, aka: ['sathy'] },
      { n: 'Perundurai', k: 'town', lat: 11.2765, lng: 77.5836 },
      { n: 'Anthiyur', k: 'town', lat: 11.5753, lng: 77.5886 },
    ] },
    { name: 'Tiruppur', aka: ['tirupur'], places: [
      { n: 'Tiruppur', k: 'main', lat: 11.1085, lng: 77.3411, aka: ['tirupur'], areas: [
        { n: 'Tiruppur Railway Station', k: 'train', lat: 11.1082, lng: 77.3399 },
        { n: 'Tiruppur Old Bus Stand', k: 'bus', lat: 11.0983, lng: 77.3483 },
      ] },
      { n: 'Udumalaipettai', k: 'town', lat: 10.5839, lng: 77.25, aka: ['udumalpet'] },
      { n: 'Dharapuram', k: 'town', lat: 10.7369, lng: 77.5261 },
      { n: 'Palladam', k: 'town', lat: 10.9962, lng: 77.2836 },
      { n: 'Kangeyam', k: 'town', lat: 11.0061, lng: 77.5607 },
      { n: 'Avinashi', k: 'town', lat: 11.19, lng: 77.268 },
    ] },
    { name: 'Vellore', places: [
      { n: 'Vellore', k: 'main', lat: 12.9165, lng: 79.1325, areas: [
        { n: 'CMC Hospital', k: 'landmark', lat: 12.925, lng: 79.1359 },
        { n: 'Katpadi Junction', k: 'train', lat: 12.9663, lng: 79.1375 },
        { n: 'Vellore New Bus Stand', k: 'bus', lat: 12.9347, lng: 79.1371 },
        { n: 'Sripuram Golden Temple', k: 'temple', lat: 12.8738, lng: 79.0883 },
      ] },
      { n: 'Gudiyatham', k: 'town', lat: 12.9486, lng: 78.8705 },
      { n: 'Katpadi', k: 'town', lat: 12.9756, lng: 79.1358 },
    ] },
    { name: 'Thanjavur', aka: ['tanjore'], places: [
      { n: 'Thanjavur', k: 'main', lat: 10.787, lng: 79.1378, aka: ['tanjore'], areas: [
        { n: 'Brihadisvara (Big) Temple', k: 'temple', lat: 10.7826, lng: 79.1314 },
        { n: 'Thanjavur Junction', k: 'train', lat: 10.7782, lng: 79.1397 },
        { n: 'Thanjavur New Bus Stand', k: 'bus', lat: 10.7501, lng: 79.1123 },
      ] },
      { n: 'Kumbakonam', k: 'temple', lat: 10.9617, lng: 79.3881 },
      { n: 'Pattukkottai', k: 'town', lat: 10.4251, lng: 79.3131 },
      { n: 'Orathanadu', k: 'town', lat: 10.6297, lng: 79.2516 },
      { n: 'Papanasam', k: 'town', lat: 10.927, lng: 79.2659 },
      { n: 'Thiruvaiyaru', k: 'temple', lat: 10.8797, lng: 79.1039 },
    ] },
    { name: 'Theni', places: [
      { n: 'Theni', k: 'main', lat: 10.0104, lng: 77.4768, areas: [
        { n: 'Theni New Bus Stand', k: 'bus', lat: 10.0099, lng: 77.4937 },
        { n: 'Allinagaram', k: 'area', lat: 10.0162, lng: 77.4801 },
        { n: 'Vaigai Dam', k: 'landmark', lat: 10.0464, lng: 77.5821 },
      ] },
      { n: 'Periyakulam', k: 'town', lat: 10.1199, lng: 77.5467 },
      { n: 'Bodinayakanur', k: 'town', lat: 10.0088, lng: 77.3495, aka: ['bodi'] },
      { n: 'Cumbum', k: 'town', lat: 9.7394, lng: 77.2853, aka: ['kambam'] },
      { n: 'Uthamapalayam', k: 'town', lat: 9.8066, lng: 77.3333 },
      { n: 'Andipatti', k: 'town', lat: 9.9987, lng: 77.6198 },
      { n: 'Chinnamanur', k: 'town', lat: 9.8416, lng: 77.3849 },
    ] },
    { name: 'Dindigul', places: [
      { n: 'Dindigul', k: 'main', lat: 10.3673, lng: 77.9803, areas: [
        { n: 'Dindigul Junction', k: 'train', lat: 10.3528, lng: 77.9834 },
        { n: 'Dindigul Bus Stand', k: 'bus', lat: 10.361, lng: 77.9798 },
      ] },
      { n: 'Palani', k: 'temple', lat: 10.45, lng: 77.52 },
      { n: 'Kodaikanal', k: 'hill', pin: '624101', lat: 10.2381, lng: 77.4892, aka: ['kodai'] },
      { n: 'Oddanchatram', k: 'town', lat: 10.4877, lng: 77.7492 },
      { n: 'Natham', k: 'town', lat: 10.2257, lng: 78.23 },
      { n: 'Vedasandur', k: 'town', lat: 10.5324, lng: 77.9463 },
      { n: 'Batlagundu', k: 'town', lat: 10.1636, lng: 77.7591, aka: ['vathalagundu'] },
      { n: 'Nilakkottai', k: 'town', lat: 10.1648, lng: 77.8529 },
    ] },
    { name: 'Thoothukudi', aka: ['tuticorin'], places: [
      { n: 'Thoothukudi', k: 'main', lat: 8.7642, lng: 78.1348, aka: ['tuticorin'], areas: [
        { n: 'Tuticorin Airport (TCR)', k: 'airport', lat: 8.7243, lng: 78.0258 },
      ] },
      { n: 'Kovilpatti', k: 'town', lat: 9.1756, lng: 77.8687 },
      { n: 'Tiruchendur', k: 'temple', lat: 8.4956, lng: 78.1233 },
      { n: 'Kayalpattinam', k: 'town', lat: 8.5635, lng: 78.1278 },
      { n: 'Srivaikuntam', k: 'town', lat: 8.6315, lng: 77.9114 },
      { n: 'Vilathikulam', k: 'town', lat: 9.1309, lng: 78.1673 },
    ] },
    { name: 'Kanyakumari', places: [
      { n: 'Nagercoil', k: 'main', lat: 8.1833, lng: 77.4119, areas: [
        { n: 'Nagercoil Junction', k: 'train', lat: 8.1745, lng: 77.4439 },
        { n: 'Vadasery Bus Stand', k: 'bus', lat: 8.191, lng: 77.4301 },
      ] },
      { n: 'Kanyakumari', k: 'beach', lat: 8.0883, lng: 77.5385, aka: ['cape comorin'] },
      { n: 'Marthandam', k: 'town', lat: 8.3065, lng: 77.2223 },
      { n: 'Colachel', k: 'town', lat: 8.1753, lng: 77.2519 },
      { n: 'Thuckalay', k: 'town', lat: 8.2472, lng: 77.315 },
      { n: 'Kulasekaram', k: 'town', lat: 8.3647, lng: 77.2997 },
    ] },
    { name: 'Kanchipuram', aka: ['kanchi', 'kancheepuram'], places: [
      { n: 'Kanchipuram', k: 'main', lat: 12.8342, lng: 79.7036, aka: ['kanchi', 'kancheepuram'] },
      { n: 'Sriperumbudur', k: 'town', lat: 12.9666, lng: 79.9458 },
      { n: 'Walajabad', k: 'town', lat: 12.7916, lng: 79.818 },
      { n: 'Uthiramerur', k: 'town', lat: 12.617, lng: 79.7598 },
    ] },
    { name: 'Chengalpattu', places: [
      { n: 'Chengalpattu', k: 'town', lat: 12.6841, lng: 79.9836 },
      { n: 'Tambaram', k: 'main', lat: 12.9245, lng: 80.1151 },
      { n: 'Mahabalipuram', k: 'beach', lat: 12.6208, lng: 80.1945, aka: ['mamallapuram'] },
      { n: 'Madurantakam', k: 'town', lat: 12.5082, lng: 79.8882 },
      { n: 'Guduvancheri', k: 'town', lat: 12.844, lng: 80.0607 },
      { n: 'Thirukalukundram', k: 'temple', lat: 12.6021, lng: 80.0591 },
      { n: 'Maraimalai Nagar', k: 'town', lat: 12.7958, lng: 80.0269 },
    ] },
    { name: 'Tiruvallur', aka: ['thiruvallur'], places: [
      { n: 'Tiruvallur', k: 'town', lat: 13.1394, lng: 79.9071 },
      { n: 'Avadi', k: 'town', lat: 13.119, lng: 80.0936 },
      { n: 'Ambattur', k: 'town', lat: 13.1056, lng: 80.164 },
      { n: 'Poonamallee', k: 'town', lat: 13.0417, lng: 80.1007 },
      { n: 'Ponneri', k: 'town', lat: 13.3362, lng: 80.1948 },
      { n: 'Tiruttani', k: 'temple', lat: 13.177, lng: 79.6128 },
      { n: 'Gummidipoondi', k: 'town', lat: 13.4167, lng: 80.1271 },
    ] },
    { name: 'Cuddalore', places: [
      { n: 'Cuddalore', k: 'main', lat: 11.748, lng: 79.7714 },
      { n: 'Chidambaram', k: 'temple', lat: 11.3993, lng: 79.6915 },
      { n: 'Neyveli', k: 'town', lat: 11.536, lng: 79.4824 },
      { n: 'Panruti', k: 'town', lat: 11.7723, lng: 79.5519 },
      { n: 'Virudhachalam', k: 'town', lat: 11.5164, lng: 79.3288 },
      { n: 'Kattumannarkoil', k: 'town', lat: 11.2748, lng: 79.5525 },
    ] },
    { name: 'Viluppuram', aka: ['villupuram'], places: [
      { n: 'Viluppuram', k: 'town', lat: 11.9426, lng: 79.4951, aka: ['villupuram'] },
      { n: 'Tindivanam', k: 'town', lat: 12.2262, lng: 79.6515 },
      { n: 'Gingee', k: 'town', lat: 12.2544, lng: 79.4158, aka: ['senji'] },
      { n: 'Vikravandi', k: 'town', lat: 12.0374, lng: 79.5436 },
    ] },
    { name: 'Kallakurichi', places: [
      { n: 'Kallakurichi', k: 'town', lat: 11.7406, lng: 78.9637 },
      { n: 'Ulundurpet', k: 'town', lat: 11.6908, lng: 79.2887 },
      { n: 'Sankarapuram', k: 'town', lat: 11.8874, lng: 78.9166 },
      { n: 'Chinnasalem', k: 'town', lat: 11.6355, lng: 78.881 },
      { n: 'Tirukoilur', k: 'temple', lat: 11.9693, lng: 79.2052 },
    ] },
    { name: 'Tiruvannamalai', aka: ['thiruvannamalai'], places: [
      { n: 'Tiruvannamalai', k: 'main', lat: 12.2253, lng: 79.0747 },
      { n: 'Arani', k: 'town', lat: 12.6677, lng: 79.2853 },
      { n: 'Cheyyar', k: 'town', lat: 12.6564, lng: 79.5405 },
      { n: 'Polur', k: 'town', lat: 12.5128, lng: 79.1265 },
      { n: 'Vandavasi', k: 'town', lat: 12.5056, lng: 79.605 },
      { n: 'Chengam', k: 'town', lat: 12.3076, lng: 78.7931 },
    ] },
    { name: 'Ranipet', places: [
      { n: 'Ranipet', k: 'town', lat: 12.9292, lng: 79.3322 },
      { n: 'Arcot', k: 'town', lat: 12.9079, lng: 79.3204 },
      { n: 'Walajapet', k: 'town', lat: 12.9255, lng: 79.3638 },
      { n: 'Arakkonam', k: 'town', lat: 13.084, lng: 79.6701 },
      { n: 'Sholinghur', k: 'temple', lat: 13.1152, lng: 79.4231 },
    ] },
    { name: 'Tirupathur', places: [
      { n: 'Tirupathur', k: 'town', lat: 12.4909, lng: 78.5647 },
      { n: 'Vaniyambadi', k: 'town', lat: 12.6787, lng: 78.62 },
      { n: 'Ambur', k: 'town', lat: 12.7874, lng: 78.7188 },
      { n: 'Jolarpettai', k: 'town', lat: 12.5643, lng: 78.5797 },
      { n: 'Yelagiri', k: 'hill', pin: '635853', lat: 12.5893, lng: 78.6324 },
    ] },
    { name: 'Krishnagiri', places: [
      { n: 'Krishnagiri', k: 'town', lat: 12.5266, lng: 78.215 },
      { n: 'Hosur', k: 'main', lat: 12.7409, lng: 77.8253 },
      { n: 'Denkanikottai', k: 'town', lat: 12.5271, lng: 77.7926 },
      { n: 'Pochampalli', k: 'town', lat: 12.3323, lng: 78.3648 },
      { n: 'Uthangarai', k: 'town', lat: 12.2659, lng: 78.5354 },
    ] },
    { name: 'Dharmapuri', places: [
      { n: 'Dharmapuri', k: 'town', lat: 12.1348, lng: 78.159 },
      { n: 'Palacode', k: 'town', lat: 12.3041, lng: 78.0729 },
      { n: 'Harur', k: 'town', lat: 12.0546, lng: 78.4786 },
      { n: 'Pennagaram', k: 'town', lat: 12.1332, lng: 77.8992 },
      { n: 'Hogenakkal', k: 'hill', lat: 12.1214, lng: 77.7777 },
    ] },
    { name: 'Namakkal', places: [
      { n: 'Namakkal', k: 'town', lat: 11.2189, lng: 78.1674 },
      { n: 'Rasipuram', k: 'town', lat: 11.4615, lng: 78.1854 },
      { n: 'Tiruchengode', k: 'temple', lat: 11.3787, lng: 77.8949 },
      { n: 'Paramathi Velur', k: 'town', lat: 11.1081, lng: 78.0095 },
      { n: 'Kumarapalayam', k: 'town', lat: 11.1163, lng: 77.6707 },
      { n: 'Kolli Hills', k: 'hill', pin: '637411', lat: 11.2794, lng: 78.332 },
    ] },
    { name: 'Karur', places: [
      { n: 'Karur', k: 'main', lat: 10.9601, lng: 78.0766 },
      { n: 'Kulithalai', k: 'town', lat: 10.9368, lng: 78.4219 },
      { n: 'Aravakurichi', k: 'town', lat: 10.777, lng: 77.9094 },
      { n: 'Krishnarayapuram', k: 'town', lat: 10.9569, lng: 78.2759 },
    ] },
    { name: 'Perambalur', places: [
      { n: 'Perambalur', k: 'town', lat: 11.2357, lng: 78.8688 },
      { n: 'Veppanthattai', k: 'town', lat: 11.3399, lng: 78.8219 },
      { n: 'Kunnam', k: 'town', lat: 11.2311, lng: 79.0213 },
    ] },
    { name: 'Ariyalur', places: [
      { n: 'Ariyalur', k: 'town', lat: 11.1358, lng: 79.0723 },
      { n: 'Jayankondam', k: 'town', lat: 11.212, lng: 79.3649 },
      { n: 'Sendurai', k: 'town', lat: 11.2539, lng: 79.1772 },
      { n: 'Gangaikonda Cholapuram', k: 'temple', lat: 11.2075, lng: 79.4491 },
    ] },
    { name: 'Pudukkottai', aka: ['pudukottai'], places: [
      { n: 'Pudukkottai', k: 'town', lat: 10.3833, lng: 78.8001, aka: ['pudukottai'] },
      { n: 'Aranthangi', k: 'town', lat: 10.1686, lng: 78.9928 },
      { n: 'Alangudi', k: 'town', lat: 10.3604, lng: 78.9779 },
      { n: 'Viralimalai', k: 'temple', lat: 10.6023, lng: 78.5471 },
      { n: 'Ponnamaravathi', k: 'town', lat: 10.2757, lng: 78.5403 },
    ] },
    { name: 'Sivaganga', places: [
      { n: 'Sivaganga', k: 'town', lat: 9.8487, lng: 78.487 },
      { n: 'Karaikudi', k: 'main', lat: 10.0731, lng: 78.7732 },
      { n: 'Devakottai', k: 'town', lat: 9.9457, lng: 78.8269 },
      { n: 'Manamadurai', k: 'town', lat: 9.6957, lng: 78.4563 },
      { n: 'Tiruppuvanam', k: 'town', lat: 9.8279, lng: 78.2555 },
      { n: 'Pillaiyarpatti', k: 'temple', lat: 10.2835, lng: 78.5192 },
    ] },
    { name: 'Ramanathapuram', aka: ['ramnad'], places: [
      { n: 'Ramanathapuram', k: 'town', lat: 9.3652, lng: 78.8343, aka: ['ramnad'] },
      { n: 'Rameswaram', k: 'temple', lat: 9.2876, lng: 79.3129, aka: ['rameshwaram'] },
      { n: 'Paramakudi', k: 'town', lat: 9.5411, lng: 78.5921 },
      { n: 'Kilakarai', k: 'town', lat: 9.2347, lng: 78.786 },
      { n: 'Mandapam', k: 'beach', lat: 9.2827, lng: 79.1527 },
      { n: 'Dhanushkodi', k: 'beach', lat: 9.1846, lng: 79.4148 },
    ] },
    { name: 'Virudhunagar', places: [
      { n: 'Virudhunagar', k: 'town', lat: 9.5822, lng: 77.9537 },
      { n: 'Sivakasi', k: 'main', lat: 9.4533, lng: 77.8024 },
      { n: 'Rajapalayam', k: 'town', lat: 9.4456, lng: 77.5543 },
      { n: 'Srivilliputhur', k: 'temple', lat: 9.5081, lng: 77.6336 },
      { n: 'Aruppukkottai', k: 'town', lat: 9.5073, lng: 78.0959 },
      { n: 'Sattur', k: 'town', lat: 9.3516, lng: 77.9211 },
    ] },
    { name: 'Tenkasi', places: [
      { n: 'Tenkasi', k: 'town', lat: 8.9568, lng: 77.3121 },
      { n: 'Courtallam', k: 'hill', lat: 8.9329, lng: 77.2715, aka: ['kutralam', 'kuttralam'] },
      { n: 'Sankarankovil', k: 'temple', lat: 9.1701, lng: 77.5354 },
      { n: 'Kadayanallur', k: 'town', lat: 9.0842, lng: 77.3462 },
      { n: 'Sengottai', k: 'town', lat: 8.9747, lng: 77.2507 },
      { n: 'Puliyangudi', k: 'town', lat: 9.1756, lng: 77.3966 },
    ] },
    { name: 'Nagapattinam', aka: ['nagai'], places: [
      { n: 'Nagapattinam', k: 'town', lat: 10.7672, lng: 79.8449, aka: ['nagai'] },
      { n: 'Velankanni', k: 'temple', lat: 10.6828, lng: 79.8486, aka: ['vailankanni'] },
      { n: 'Vedaranyam', k: 'town', lat: 10.375, lng: 79.8489 },
      { n: 'Nagore', k: 'temple', lat: 10.8167, lng: 79.8404 },
    ] },
    { name: 'Mayiladuthurai', aka: ['mayavaram'], places: [
      { n: 'Mayiladuthurai', k: 'town', lat: 11.1019, lng: 79.6503, aka: ['mayavaram'] },
      { n: 'Sirkazhi', k: 'town', lat: 11.2378, lng: 79.7396 },
      { n: 'Poompuhar', k: 'beach', lat: 11.1453, lng: 79.8537 },
      { n: 'Tharangambadi', k: 'beach', lat: 11.0299, lng: 79.8522, aka: ['tranquebar'] },
    ] },
    { name: 'Tiruvarur', aka: ['thiruvarur'], places: [
      { n: 'Tiruvarur', k: 'temple', lat: 10.7667, lng: 79.6352 },
      { n: 'Mannargudi', k: 'town', lat: 10.6673, lng: 79.4444 },
      { n: 'Thiruthuraipoondi', k: 'town', lat: 10.5317, lng: 79.6401 },
      { n: 'Needamangalam', k: 'town', lat: 10.7717, lng: 79.4145 },
    ] },
    { name: 'Nilgiris', aka: ['neelagiri'], places: [
      { n: 'Ooty', k: 'main', pin: '643001', lat: 11.4102, lng: 76.695, aka: ['udhagamandalam', 'ootacamund'] },
      { n: 'Coonoor', k: 'hill', pin: '643101', lat: 11.3459, lng: 76.7965 },
      { n: 'Kotagiri', k: 'hill', pin: '643217', lat: 11.423, lng: 76.8658 },
      { n: 'Gudalur', k: 'hill', lat: 11.4992, lng: 76.4924 },
    ] },
  ] },
  { id: 'py', name: 'Puducherry', districts: [
    { name: 'Puducherry', aka: ['pondicherry', 'pondy'], places: [
      { n: 'Pondicherry', k: 'main', lat: 11.9416, lng: 79.8083, aka: ['puducherry', 'pondy'], areas: [
        { n: 'Puducherry Airport (PNY)', k: 'airport', lat: 11.968, lng: 79.812 },
        { n: 'White Town', k: 'landmark', lat: 11.9289, lng: 79.8313 },
        { n: 'Pondicherry Bus Stand', k: 'bus', lat: 11.9331, lng: 79.8162 },
        { n: 'Auroville', k: 'landmark', lat: 12.0074, lng: 79.8099 },
        { n: 'Lawspet', k: 'area', lat: 11.9546, lng: 79.8119 },
      ] },
      { n: 'Ariyankuppam', k: 'town', lat: 11.8949, lng: 79.8076 },
      { n: 'Villianur', k: 'town', lat: 11.9133, lng: 79.7551 },
    ] },
    { name: 'Karaikal', places: [
      { n: 'Karaikal', k: 'beach', lat: 10.9157, lng: 79.8376 },
      { n: 'Thirunallar', k: 'temple', lat: 10.926, lng: 79.793 },
    ] },
  ] },
  { id: 'kl', name: 'Kerala', districts: [
    { name: 'Thiruvananthapuram', aka: ['trivandrum'], places: [
      { n: 'Trivandrum', k: 'main', lat: 8.5241, lng: 76.9366, aka: ['thiruvananthapuram'], areas: [
        { n: 'Trivandrum International Airport (TRV)', k: 'airport', lat: 8.4821, lng: 76.9201 },
        { n: 'Trivandrum Central Station', k: 'train', lat: 8.487, lng: 76.9526 },
        { n: 'Technopark', k: 'landmark', lat: 8.5578, lng: 76.8807 },
        { n: 'Padmanabhaswamy Temple', k: 'temple', lat: 8.4827, lng: 76.9474 },
        { n: 'Kazhakkoottam', k: 'area', lat: 8.566, lng: 76.8738 },
      ] },
      { n: 'Neyyattinkara', k: 'town', lat: 8.3995, lng: 77.0872 },
      { n: 'Varkala', k: 'beach', lat: 8.734, lng: 76.7253 },
      { n: 'Attingal', k: 'town', lat: 8.6986, lng: 76.8134 },
      { n: 'Kovalam', k: 'beach', lat: 8.3903, lng: 76.9785 },
    ] },
    { name: 'Kollam', aka: ['quilon'], places: [
      { n: 'Kollam', k: 'town', lat: 8.8871, lng: 76.5907, aka: ['quilon'] },
      { n: 'Punalur', k: 'town', lat: 9.0175, lng: 76.9265 },
      { n: 'Karunagappally', k: 'town', lat: 9.0551, lng: 76.5354 },
      { n: 'Kottarakkara', k: 'town', lat: 9.0055, lng: 76.7832 },
    ] },
    { name: 'Pathanamthitta', places: [
      { n: 'Pathanamthitta', k: 'town', lat: 9.2655, lng: 76.7872 },
      { n: 'Thiruvalla', k: 'town', lat: 9.3867, lng: 76.5763 },
      { n: 'Adoor', k: 'town', lat: 9.153, lng: 76.7356 },
      { n: 'Sabarimala', k: 'temple', lat: 9.4366, lng: 77.0804 },
      { n: 'Pandalam', k: 'temple', lat: 9.2251, lng: 76.6781 },
    ] },
    { name: 'Alappuzha', aka: ['alleppey'], places: [
      { n: 'Alappuzha', k: 'beach', lat: 9.4981, lng: 76.3388, aka: ['alleppey'] },
      { n: 'Cherthala', k: 'town', lat: 9.6862, lng: 76.3426 },
      { n: 'Chengannur', k: 'town', lat: 9.3179, lng: 76.6139 },
      { n: 'Kayamkulam', k: 'town', lat: 9.1724, lng: 76.5001 },
    ] },
    { name: 'Kottayam', places: [
      { n: 'Kottayam', k: 'town', lat: 9.5916, lng: 76.5222 },
      { n: 'Changanassery', k: 'town', lat: 9.4465, lng: 76.5403 },
      { n: 'Pala', k: 'town', lat: 9.7131, lng: 76.6831 },
      { n: 'Kumarakom', k: 'town', lat: 9.5961, lng: 76.4305 },
      { n: 'Vaikom', k: 'temple', lat: 9.7498, lng: 76.3926 },
    ] },
    { name: 'Idukki', places: [
      { n: 'Painavu', k: 'town', lat: 9.854, lng: 76.9446 },
      { n: 'Munnar', k: 'hill', pin: '685612', lat: 10.0889, lng: 77.0595 },
      { n: 'Thekkady', k: 'hill', pin: '685509', lat: 9.5805, lng: 77.1811 },
      { n: 'Thodupuzha', k: 'town', lat: 9.8977, lng: 76.7134 },
      { n: 'Kumily', k: 'town', pin: '685509', lat: 9.6068, lng: 77.1671 },
      { n: 'Vagamon', k: 'hill', pin: '685503', lat: 9.6886, lng: 76.9069 },
    ] },
    { name: 'Ernakulam', places: [
      { n: 'Kochi', k: 'main', lat: 9.9312, lng: 76.2673, aka: ['cochin'], areas: [
        { n: 'Cochin International Airport (COK)', k: 'airport', lat: 10.1518, lng: 76.4019 },
        { n: 'Ernakulam Junction', k: 'train', lat: 9.969, lng: 76.291 },
        { n: 'Fort Kochi', k: 'beach', lat: 9.9676, lng: 76.2422 },
        { n: 'Edappally', k: 'area', lat: 10.0252, lng: 76.3114 },
        { n: 'Kakkanad', k: 'area', lat: 10.0166, lng: 76.3427 },
        { n: 'Vyttila Mobility Hub', k: 'bus', lat: 9.9686, lng: 76.3218 },
      ] },
      { n: 'Aluva', k: 'town', lat: 10.1078, lng: 76.3569 },
      { n: 'Angamaly', k: 'town', lat: 10.191, lng: 76.3874 },
      { n: 'Perumbavoor', k: 'town', lat: 10.1148, lng: 76.4778 },
      { n: 'Muvattupuzha', k: 'town', lat: 9.9831, lng: 76.5782 },
      { n: 'Kothamangalam', k: 'town', lat: 10.064, lng: 76.6218 },
    ] },
    { name: 'Thrissur', aka: ['trichur'], places: [
      { n: 'Thrissur', k: 'main', lat: 10.5276, lng: 76.2144, aka: ['trichur'] },
      { n: 'Guruvayur', k: 'temple', lat: 10.5943, lng: 76.0411 },
      { n: 'Chalakudy', k: 'town', lat: 10.3042, lng: 76.3371 },
      { n: 'Irinjalakuda', k: 'town', lat: 10.3454, lng: 76.2158 },
      { n: 'Kodungallur', k: 'town', lat: 10.2277, lng: 76.1972 },
    ] },
    { name: 'Palakkad', aka: ['palghat'], places: [
      { n: 'Palakkad', k: 'main', lat: 10.7867, lng: 76.6548, aka: ['palghat'] },
      { n: 'Ottapalam', k: 'town', lat: 10.7732, lng: 76.3772 },
      { n: 'Chittur', k: 'town', lat: 10.6855, lng: 76.7162 },
      { n: 'Mannarkkad', k: 'town', lat: 10.9929, lng: 76.4569 },
      { n: 'Nelliampathy', k: 'hill', pin: '678508', lat: 10.5349, lng: 76.6933 },
    ] },
    { name: 'Malappuram', places: [
      { n: 'Malappuram', k: 'town', lat: 11.0429, lng: 76.0808 },
      { n: 'Manjeri', k: 'town', lat: 11.1202, lng: 76.1198 },
      { n: 'Tirur', k: 'town', lat: 10.9167, lng: 75.924 },
      { n: 'Perinthalmanna', k: 'town', lat: 10.9761, lng: 76.2255 },
      { n: 'Ponnani', k: 'town', lat: 10.7801, lng: 75.9189 },
    ] },
    { name: 'Kozhikode', aka: ['calicut'], places: [
      { n: 'Calicut', k: 'main', lat: 11.2588, lng: 75.7804, aka: ['kozhikode'], areas: [
        { n: 'Kozhikode Calicut Airport (CCJ)', k: 'airport', lat: 11.1369, lng: 75.9553 },
        { n: 'Kozhikode Railway Station', k: 'train', lat: 11.2461, lng: 75.7812 },
        { n: 'Kozhikode Beach', k: 'beach', lat: 11.2555, lng: 75.7697 },
      ] },
      { n: 'Vadakara', k: 'town', lat: 11.5985, lng: 75.5897 },
      { n: 'Koyilandy', k: 'town', lat: 11.4384, lng: 75.6969 },
      { n: 'Thamarassery', k: 'town', lat: 11.4178, lng: 75.9369 },
    ] },
    { name: 'Wayanad', places: [
      { n: 'Kalpetta', k: 'hill', pin: '673121', lat: 11.6103, lng: 76.0828 },
      { n: 'Sulthan Bathery', k: 'town', lat: 11.6632, lng: 76.2596 },
      { n: 'Mananthavady', k: 'town', lat: 11.801, lng: 76.0057 },
      { n: 'Vythiri', k: 'hill', pin: '673576', lat: 11.5561, lng: 76.0389 },
    ] },
    { name: 'Kannur', aka: ['cannanore'], places: [
      { n: 'Kannur', k: 'beach', lat: 11.8764, lng: 75.3738, aka: ['cannanore'], areas: [
        { n: 'Kannur International Airport (CNN)', k: 'airport', lat: 11.9186, lng: 75.5472 },
      ] },
      { n: 'Thalassery', k: 'town', lat: 11.7491, lng: 75.4932 },
      { n: 'Payyanur', k: 'town', lat: 12.106, lng: 75.2073 },
      { n: 'Mattannur', k: 'town', lat: 11.9308, lng: 75.5713 },
    ] },
    { name: 'Kasaragod', places: [
      { n: 'Kasaragod', k: 'town', lat: 12.5036, lng: 74.9907 },
      { n: 'Kanhangad', k: 'town', lat: 12.3136, lng: 75.0925 },
      { n: 'Bekal', k: 'beach', lat: 12.3957, lng: 75.0372 },
    ] },
  ] },
  { id: 'ka', name: 'Karnataka', districts: [
    { name: 'Bengaluru Urban', aka: ['bangalore', 'bengaluru'], places: [
      { n: 'Bangalore', k: 'main', lat: 12.9716, lng: 77.5946, aka: ['bengaluru'], areas: [
        { n: 'Kempegowda International Airport (BLR)', k: 'airport', lat: 13.1986, lng: 77.7066 },
        { n: 'Majestic (KSR Station)', k: 'train', lat: 12.9759, lng: 77.5654 },
        { n: 'Yeshwanthpur Junction', k: 'train', lat: 13.0238, lng: 77.5508 },
        { n: 'Electronic City', k: 'area', lat: 12.8436, lng: 77.6687 },
        { n: 'Whitefield', k: 'area', lat: 12.9696, lng: 77.7497 },
        { n: 'Koramangala', k: 'area', lat: 12.9357, lng: 77.6241 },
        { n: 'Indiranagar', k: 'area', lat: 12.9733, lng: 77.6405 },
        { n: 'Hebbal', k: 'area', lat: 13.0382, lng: 77.5919 },
        { n: 'Silk Board', k: 'area', lat: 12.916, lng: 77.6239 },
        { n: 'Marathahalli', k: 'area', lat: 12.9553, lng: 77.6984 },
        { n: 'Jayanagar', k: 'area', lat: 12.9293, lng: 77.5824 },
      ] },
      { n: 'Anekal', k: 'town', lat: 12.7086, lng: 77.6994 },
      { n: 'Yelahanka', k: 'town', lat: 13.1007, lng: 77.5963 },
    ] },
    { name: 'Bengaluru Rural', places: [
      { n: 'Devanahalli', k: 'town', lat: 13.2484, lng: 77.7134 },
      { n: 'Doddaballapura', k: 'town', lat: 13.293, lng: 77.5431 },
      { n: 'Nelamangala', k: 'town', lat: 13.0953, lng: 77.3964 },
      { n: 'Hoskote', k: 'town', lat: 13.073, lng: 77.7921 },
    ] },
    { name: 'Mysuru', aka: ['mysore'], places: [
      { n: 'Mysore', k: 'main', lat: 12.2958, lng: 76.6394, aka: ['mysuru'], areas: [
        { n: 'Mysuru Airport (MYQ)', k: 'airport', lat: 12.23, lng: 76.6558 },
        { n: 'Mysore Palace', k: 'landmark', lat: 12.3052, lng: 76.6554 },
        { n: 'Mysuru Junction', k: 'train', lat: 12.317, lng: 76.6453 },
        { n: 'Chamundi Hills', k: 'temple', lat: 12.2962, lng: 76.6376 },
      ] },
      { n: 'Nanjangud', k: 'temple', lat: 12.1187, lng: 76.6818 },
      { n: 'Hunsur', k: 'town', lat: 12.3035, lng: 76.2928 },
    ] },
    { name: 'Ramanagara', places: [
      { n: 'Ramanagara', k: 'town', lat: 12.7253, lng: 77.2805 },
      { n: 'Channapatna', k: 'town', lat: 12.6545, lng: 77.2043 },
      { n: 'Kanakapura', k: 'town', lat: 12.545, lng: 77.4199 },
      { n: 'Magadi', k: 'town', lat: 12.9567, lng: 77.2242 },
    ] },
    { name: 'Mandya', places: [
      { n: 'Mandya', k: 'town', lat: 12.5239, lng: 76.8962 },
      { n: 'Maddur', k: 'town', lat: 12.5849, lng: 77.0449 },
      { n: 'Srirangapatna', k: 'temple', lat: 12.4226, lng: 76.6849 },
      { n: 'Melukote', k: 'temple', lat: 12.6624, lng: 76.6496 },
    ] },
    { name: 'Chamarajanagar', places: [
      { n: 'Chamarajanagar', k: 'town', lat: 11.9238, lng: 76.9394 },
      { n: 'Kollegal', k: 'town', lat: 12.1561, lng: 77.1072 },
      { n: 'Gundlupet', k: 'town', lat: 11.8085, lng: 76.6916 },
    ] },
    { name: 'Hassan', places: [
      { n: 'Hassan', k: 'town', lat: 13.0071, lng: 76.0993 },
      { n: 'Belur', k: 'temple', lat: 13.1646, lng: 75.8635 },
      { n: 'Halebidu', k: 'temple', lat: 13.2168, lng: 75.9919 },
      { n: 'Sakleshpur', k: 'hill', pin: '573134', lat: 12.9434, lng: 75.7862 },
      { n: 'Shravanabelagola', k: 'temple', lat: 12.8581, lng: 76.487 },
    ] },
    { name: 'Kodagu', aka: ['coorg'], places: [
      { n: 'Madikeri', k: 'hill', pin: '571201', lat: 12.4215, lng: 75.7388, aka: ['coorg', 'mercara'] },
      { n: 'Kushalnagar', k: 'town', lat: 12.4586, lng: 75.9614 },
      { n: 'Virajpet', k: 'town', lat: 12.1973, lng: 75.8033 },
    ] },
    { name: 'Chikkamagaluru', aka: ['chikmagalur'], places: [
      { n: 'Chikkamagaluru', k: 'hill', pin: '577101', lat: 13.318, lng: 75.7739, aka: ['chikmagalur'] },
      { n: 'Kadur', k: 'town', lat: 13.5528, lng: 76.0142 },
      { n: 'Mudigere', k: 'town', lat: 13.1333, lng: 75.6419 },
      { n: 'Sringeri', k: 'temple', lat: 13.4262, lng: 75.2554 },
    ] },
    { name: 'Tumakuru', aka: ['tumkur'], places: [
      { n: 'Tumakuru', k: 'town', lat: 13.3401, lng: 77.1006, aka: ['tumkur'] },
      { n: 'Tiptur', k: 'town', lat: 13.2586, lng: 76.4738 },
      { n: 'Sira', k: 'town', lat: 13.7409, lng: 76.9057 },
      { n: 'Kunigal', k: 'town', lat: 13.026, lng: 77.0223 },
    ] },
    { name: 'Kolar', places: [
      { n: 'Kolar', k: 'town', lat: 13.1367, lng: 78.1337 },
      { n: 'Kolar Gold Fields', k: 'town', lat: 12.9546, lng: 78.2731, aka: ['kgf'] },
      { n: 'Mulbagal', k: 'town', lat: 13.166, lng: 78.3927 },
      { n: 'Malur', k: 'town', lat: 13.0059, lng: 77.9394 },
    ] },
    { name: 'Chikkaballapura', places: [
      { n: 'Chikkaballapur', k: 'town', lat: 13.4274, lng: 77.7321 },
      { n: 'Chintamani', k: 'town', lat: 13.3987, lng: 78.0533 },
      { n: 'Gauribidanur', k: 'town', lat: 13.6115, lng: 77.5168 },
      { n: 'Nandi Hills', k: 'hill', pin: '562103', lat: 13.3701, lng: 77.6842 },
    ] },
    { name: 'Dakshina Kannada', places: [
      { n: 'Mangalore', k: 'main', lat: 12.8698, lng: 74.843, aka: ['mangaluru'], areas: [
        { n: 'Mangaluru International Airport (IXE)', k: 'airport', lat: 12.9613, lng: 74.8901 },
      ] },
      { n: 'Puttur', k: 'town', lat: 12.7633, lng: 75.2018 },
      { n: 'Bantwal', k: 'town', lat: 12.8954, lng: 75.0409 },
      { n: 'Dharmasthala', k: 'temple', lat: 12.952, lng: 75.3813 },
      { n: 'Subramanya', k: 'temple', lat: 12.6678, lng: 75.6132 },
    ] },
    { name: 'Udupi', places: [
      { n: 'Udupi', k: 'temple', lat: 13.3419, lng: 74.7473 },
      { n: 'Manipal', k: 'town', lat: 13.352, lng: 74.787 },
      { n: 'Kundapura', k: 'beach', lat: 13.6251, lng: 74.6916 },
      { n: 'Karkala', k: 'town', lat: 13.2145, lng: 74.9952 },
      { n: 'Kollur', k: 'temple', lat: 13.8634, lng: 74.8138 },
    ] },
    { name: 'Uttara Kannada', places: [
      { n: 'Karwar', k: 'beach', lat: 14.8122, lng: 74.1323 },
      { n: 'Sirsi', k: 'town', lat: 14.6192, lng: 74.8389 },
      { n: 'Gokarna', k: 'temple', lat: 14.544, lng: 74.3184 },
      { n: 'Dandeli', k: 'hill', lat: 15.249, lng: 74.6236 },
      { n: 'Murudeshwara', k: 'temple', lat: 14.096, lng: 74.4883 },
    ] },
    { name: 'Shivamogga', aka: ['shimoga'], places: [
      { n: 'Shivamogga', k: 'town', lat: 13.9326, lng: 75.575, aka: ['shimoga'] },
      { n: 'Bhadravati', k: 'town', lat: 13.8502, lng: 75.7038 },
      { n: 'Sagara', k: 'town', lat: 14.1665, lng: 75.0264 },
    ] },
    { name: 'Davanagere', places: [
      { n: 'Davanagere', k: 'town', lat: 14.4661, lng: 75.9206 },
      { n: 'Harihar', k: 'town', lat: 14.5117, lng: 75.8093 },
    ] },
    { name: 'Chitradurga', places: [
      { n: 'Chitradurga', k: 'town', lat: 14.2266, lng: 76.4005 },
      { n: 'Hiriyur', k: 'town', lat: 13.9443, lng: 76.6167 },
      { n: 'Challakere', k: 'town', lat: 14.3168, lng: 76.6522 },
    ] },
    { name: 'Dharwad', places: [
      { n: 'Hubli', k: 'main', lat: 15.3518, lng: 75.138, aka: ['hubballi'], areas: [
        { n: 'Hubballi Airport (HBX)', k: 'airport', lat: 15.3617, lng: 75.0849 },
      ] },
      { n: 'Dharwad', k: 'town', lat: 15.4541, lng: 75.0067 },
    ] },
    { name: 'Belagavi', aka: ['belgaum'], places: [
      { n: 'Belagavi', k: 'town', lat: 15.8573, lng: 74.5069, aka: ['belgaum'], areas: [
        { n: 'Belagavi Airport (IXG)', k: 'airport', lat: 15.8593, lng: 74.6183 },
      ] },
      { n: 'Gokak', k: 'town', lat: 16.1693, lng: 74.8224 },
      { n: 'Chikodi', k: 'town', lat: 16.4265, lng: 74.5861 },
      { n: 'Nipani', k: 'town', lat: 16.402, lng: 74.3842 },
    ] },
    { name: 'Ballari', aka: ['bellary'], places: [
      { n: 'Ballari', k: 'town', lat: 15.143, lng: 76.9173, aka: ['bellary'] },
      { n: 'Siruguppa', k: 'town', lat: 15.6346, lng: 76.8937 },
    ] },
    { name: 'Vijayanagara', places: [
      { n: 'Hosapete', k: 'town', lat: 15.2665, lng: 76.3872, aka: ['hospet'] },
      { n: 'Hampi', k: 'temple', lat: 15.3358, lng: 76.461 },
    ] },
    { name: 'Kalaburagi', aka: ['gulbarga'], places: [
      { n: 'Kalaburagi', k: 'town', lat: 17.331, lng: 76.8334, aka: ['gulbarga'] },
      { n: 'Sedam', k: 'town', lat: 17.1773, lng: 77.2824 },
    ] },
    { name: 'Vijayapura', aka: ['bijapur'], places: [
      { n: 'Vijayapura', k: 'town', lat: 16.827, lng: 75.7175, aka: ['bijapur'] },
      { n: 'Indi', k: 'town', lat: 17.1745, lng: 75.9554 },
    ] },
    { name: 'Raichur', places: [
      { n: 'Raichur', k: 'town', lat: 16.1983, lng: 77.3527 },
      { n: 'Sindhanur', k: 'town', lat: 15.7686, lng: 76.755 },
    ] },
    { name: 'Bidar', places: [
      { n: 'Bidar', k: 'town', lat: 17.9166, lng: 77.5113 },
      { n: 'Basavakalyan', k: 'town', lat: 17.8698, lng: 76.951 },
    ] },
    { name: 'Bagalkote', places: [
      { n: 'Bagalkot', k: 'town', lat: 16.1853, lng: 75.6968 },
      { n: 'Badami', k: 'temple', lat: 15.9204, lng: 75.6808 },
      { n: 'Jamkhandi', k: 'town', lat: 16.5039, lng: 75.291 },
    ] },
    { name: 'Gadag', places: [
      { n: 'Gadag', k: 'town', lat: 15.4222, lng: 75.6377 },
    ] },
    { name: 'Haveri', places: [
      { n: 'Haveri', k: 'town', lat: 14.7875, lng: 75.3997 },
      { n: 'Ranibennur', k: 'town', lat: 14.6166, lng: 75.6342 },
    ] },
    { name: 'Koppal', places: [
      { n: 'Koppal', k: 'town', lat: 15.3484, lng: 76.1547 },
      { n: 'Gangavathi', k: 'town', lat: 15.4309, lng: 76.532 },
    ] },
    { name: 'Yadgir', places: [
      { n: 'Yadgir', k: 'town', lat: 16.7634, lng: 77.1385 },
    ] },
  ] },
  { id: 'ap', name: 'Andhra Pradesh', districts: [
    { name: 'Tirupati', places: [
      { n: 'Tirupati', k: 'main', lat: 13.6288, lng: 79.4192, aka: ['tirupathi'], areas: [
        { n: 'Tirupati Airport (TIR)', k: 'airport', lat: 13.6325, lng: 79.5433 },
        { n: 'Tirupati Railway Station', k: 'train', lat: 13.6283, lng: 79.4195 },
        { n: 'Alipiri', k: 'temple', lat: 13.6458, lng: 79.4072 },
      ] },
      { n: 'Tirumala', k: 'temple', lat: 13.6868, lng: 79.3524 },
      { n: 'Srikalahasti', k: 'temple', lat: 13.7518, lng: 79.7002 },
    ] },
    { name: 'Chittoor', places: [
      { n: 'Chittoor', k: 'town', lat: 13.2161, lng: 79.0973 },
      { n: 'Palamaner', k: 'town', lat: 13.2004, lng: 78.7477 },
      { n: 'Kuppam', k: 'town', lat: 12.7452, lng: 78.3443 },
      { n: 'Punganur', k: 'town', lat: 13.3641, lng: 78.573 },
    ] },
    { name: 'Nellore', places: [
      { n: 'Nellore', k: 'town', lat: 14.4494, lng: 79.9874 },
      { n: 'Kavali', k: 'town', lat: 14.9136, lng: 79.9927 },
    ] },
    { name: 'YSR Kadapa', aka: ['cuddapah'], places: [
      { n: 'Kadapa', k: 'town', lat: 14.4753, lng: 78.8217, aka: ['cuddapah'], areas: [
        { n: 'Kadapa Airport (CDP)', k: 'airport', lat: 14.51, lng: 78.7728 },
      ] },
      { n: 'Proddatur', k: 'town', lat: 14.7556, lng: 78.5502 },
      { n: 'Pulivendula', k: 'town', lat: 14.4229, lng: 78.2266 },
    ] },
    { name: 'Annamayya', places: [
      { n: 'Madanapalle', k: 'town', lat: 13.5558, lng: 78.5015 },
      { n: 'Rayachoty', k: 'town', lat: 14.0555, lng: 78.751 },
      { n: 'Horsley Hills', k: 'hill', lat: 13.6509, lng: 78.3965 },
    ] },
    { name: 'Anantapur', places: [
      { n: 'Anantapur', k: 'town', lat: 14.6783, lng: 77.6065 },
      { n: 'Guntakal', k: 'town', lat: 15.163, lng: 77.3769 },
      { n: 'Tadipatri', k: 'town', lat: 14.907, lng: 78.0097 },
    ] },
    { name: 'Sri Sathya Sai', places: [
      { n: 'Puttaparthi', k: 'temple', lat: 14.1637, lng: 77.8125 },
      { n: 'Hindupur', k: 'town', lat: 13.8306, lng: 77.4926 },
      { n: 'Dharmavaram', k: 'town', lat: 14.4138, lng: 77.7208 },
      { n: 'Kadiri', k: 'town', lat: 14.1082, lng: 78.1611 },
    ] },
    { name: 'Kurnool', places: [
      { n: 'Kurnool', k: 'town', lat: 15.8309, lng: 78.0425, areas: [
        { n: 'Kurnool Airport (KJB)', k: 'airport', lat: 15.7117, lng: 78.1647 },
      ] },
      { n: 'Adoni', k: 'town', lat: 15.6261, lng: 77.2724 },
      { n: 'Mantralayam', k: 'temple', lat: 15.9414, lng: 77.4237 },
    ] },
    { name: 'Nandyal', places: [
      { n: 'Nandyal', k: 'town', lat: 15.4736, lng: 78.4807 },
      { n: 'Srisailam', k: 'temple', lat: 16.075, lng: 78.8726 },
    ] },
    { name: 'Prakasam', places: [
      { n: 'Ongole', k: 'town', lat: 15.5059, lng: 80.0499 },
      { n: 'Markapur', k: 'town', lat: 15.7407, lng: 79.2699 },
    ] },
    { name: 'Guntur', places: [
      { n: 'Guntur', k: 'town', lat: 16.2915, lng: 80.4542 },
      { n: 'Tenali', k: 'town', lat: 16.2378, lng: 80.6464 },
      { n: 'Mangalagiri', k: 'town', lat: 16.4318, lng: 80.5688 },
    ] },
    { name: 'NTR', places: [
      { n: 'Vijayawada', k: 'main', lat: 16.5192, lng: 80.6238, areas: [
        { n: 'Vijayawada Airport (VGA)', k: 'airport', lat: 16.5304, lng: 80.7968 },
        { n: 'Vijayawada Junction', k: 'train', lat: 16.518, lng: 80.6196 },
      ] },
      { n: 'Nandigama', k: 'town', lat: 16.7735, lng: 80.2855 },
    ] },
    { name: 'Krishna', places: [
      { n: 'Machilipatnam', k: 'beach', lat: 16.1817, lng: 81.1348 },
      { n: 'Gudivada', k: 'town', lat: 16.433, lng: 80.9937 },
    ] },
    { name: 'Eluru', places: [
      { n: 'Eluru', k: 'town', lat: 16.7104, lng: 81.1154 },
      { n: 'Nuzvid', k: 'town', lat: 16.7907, lng: 80.8476 },
    ] },
    { name: 'East Godavari', places: [
      { n: 'Rajahmundry', k: 'town', lat: 17.005, lng: 81.7805, aka: ['rajamahendravaram'], areas: [
        { n: 'Rajahmundry Airport (RJA)', k: 'airport', lat: 17.1104, lng: 81.8182 },
      ] },
      { n: 'Kovvur', k: 'town', lat: 17.0177, lng: 81.7314 },
    ] },
    { name: 'Kakinada', places: [
      { n: 'Kakinada', k: 'beach', lat: 16.9437, lng: 82.2351 },
      { n: 'Annavaram', k: 'temple', lat: 17.2833, lng: 82.408 },
    ] },
    { name: 'Visakhapatnam', aka: ['vizag'], places: [
      { n: 'Visakhapatnam', k: 'main', lat: 17.6936, lng: 83.2921, aka: ['vizag'], areas: [
        { n: 'Visakhapatnam Airport (VTZ)', k: 'airport', lat: 17.7212, lng: 83.2245 },
      ] },
      { n: 'Bheemunipatnam', k: 'beach', lat: 17.8914, lng: 83.4509 },
    ] },
    { name: 'Vizianagaram', places: [
      { n: 'Vizianagaram', k: 'town', lat: 18.1141, lng: 83.4114 },
    ] },
    { name: 'Srikakulam', places: [
      { n: 'Srikakulam', k: 'town', lat: 18.2949, lng: 83.8939 },
    ] },
  ] },
  { id: 'ts', name: 'Telangana', districts: [
    { name: 'Hyderabad', places: [
      { n: 'Hyderabad', k: 'main', lat: 17.385, lng: 78.4867, areas: [
        { n: 'Rajiv Gandhi International Airport (HYD)', k: 'airport', lat: 17.2403, lng: 78.4294 },
        { n: 'Charminar', k: 'landmark', lat: 17.3619, lng: 78.48 },
        { n: 'HITEC City', k: 'area', lat: 17.4508, lng: 78.3835 },
        { n: 'Gachibowli', k: 'area', lat: 17.4436, lng: 78.352 },
        { n: 'Ameerpet', k: 'area', lat: 17.4375, lng: 78.4483 },
        { n: 'Mahatma Gandhi Bus Station', k: 'bus', lat: 17.3781, lng: 78.4846 },
      ] },
      { n: 'Secunderabad', k: 'town', lat: 17.4337, lng: 78.5007 },
    ] },
    { name: 'Rangareddy', places: [
      { n: 'Shamshabad', k: 'town', lat: 17.2611, lng: 78.3932 },
      { n: 'Shadnagar', k: 'town', lat: 17.0672, lng: 78.2046 },
    ] },
    { name: 'Sangareddy', places: [
      { n: 'Sangareddy', k: 'town', lat: 17.6155, lng: 78.0817 },
      { n: 'Zaheerabad', k: 'town', lat: 17.6794, lng: 77.6153 },
    ] },
    { name: 'Hanumakonda', places: [
      { n: 'Warangal', k: 'main', lat: 17.9821, lng: 79.5971 },
      { n: 'Hanamkonda', k: 'town', lat: 18.0069, lng: 79.5579 },
    ] },
    { name: 'Karimnagar', places: [
      { n: 'Karimnagar', k: 'town', lat: 18.4348, lng: 79.1328 },
    ] },
    { name: 'Nizamabad', places: [
      { n: 'Nizamabad', k: 'town', lat: 18.6732, lng: 78.0978 },
      { n: 'Bodhan', k: 'town', lat: 18.6537, lng: 77.8937 },
    ] },
    { name: 'Khammam', places: [
      { n: 'Khammam', k: 'town', lat: 17.2465, lng: 80.15 },
    ] },
    { name: 'Mahabubnagar', places: [
      { n: 'Mahabubnagar', k: 'town', lat: 16.7435, lng: 77.9923 },
    ] },
    { name: 'Nalgonda', places: [
      { n: 'Nalgonda', k: 'town', lat: 17.0504, lng: 79.2669 },
      { n: 'Miryalaguda', k: 'town', lat: 16.871, lng: 79.5617 },
    ] },
  ] },
];

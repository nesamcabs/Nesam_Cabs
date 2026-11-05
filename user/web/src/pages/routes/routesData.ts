import type { GeoPlace } from '@core/types';

export interface RouteFaq {
  q: string;
  a: string;
}

export interface RouteKeyStop {
  name: string;
  description: string;
}

export interface RouteTariffEstimate {
  category: string;
  seats: string;
  perKm: number;
  driverBata: number;
  estimatedOneWay: number;
  model: string;
}

export interface RouteCorridorDetail {
  id: string;
  slug: string;
  title: string;
  h1: string;
  origin: string;
  destination: string;
  distanceKm: number;
  duration: string;
  highway: string;
  pickup: GeoPlace;
  drop: GeoPlace;
  image: string;
  metaDescription: string;
  keywords: string;
  summary: string;
  overview: string[];
  keyStops: RouteKeyStop[];
  estimates: RouteTariffEstimate[];
  faqs: RouteFaq[];
}

const place = (id: string, name: string, address: string, lat: number, lng: number): GeoPlace => ({
  id,
  name,
  address,
  lat,
  lng,
  type: 'other',
});

export const ALL_ROUTES: RouteCorridorDetail[] = [
  {
    id: 'chennai-pondicherry',
    slug: 'chennai-to-pondicherry',
    title: 'Chennai to Pondicherry Drop Taxi | One Way & Round Trip Cab',
    h1: 'Chennai to Pondicherry One Way Drop Taxi & Outstation Cab',
    origin: 'Chennai',
    destination: 'Pondicherry',
    distanceKm: 150,
    duration: '3 hr 10 min',
    highway: 'East Coast Road (ECR / SH-49) & NH-32',
    pickup: place('p-chn', 'Chennai Central', 'Chennai, Tamil Nadu', 13.0827, 80.2707),
    drop: place('d-pnd', 'Pondicherry White Town', 'Puducherry', 11.9416, 79.8083),
    image: '/website-images/web/destinations/route-chennai-pondicherry.webp',
    metaDescription:
      'Book Chennai to Pondicherry one-way drop taxi or round trip cab with NESAM Cabs. Pay only for one-way distance with zero return fare. Clean AC sedans, SUVs & Crysta.',
    keywords:
      'chennai to pondicherry drop taxi, chennai to pondicherry cab, one way taxi chennai to pondi, ecr cab chennai to pondicherry, chennai airport to pondicherry taxi fare, innova crysta chennai to pondicherry',
    summary:
      'Travel smoothly from Chennai to Pondicherry along the picturesque East Coast Road (ECR). Enjoy upfront fares, zero return fare on one-way drops, and verified commercial drivers.',
    overview: [
      'The Chennai to Pondicherry corridor is one of the most scenic coastal highway road trips in South India. Stretching approximately 150 km via the East Coast Road (ECR), you travel past the Bay of Bengal shoreline, historic temples, and quiet fishing hamlets.',
      'With NESAM Cabs one-way drop taxi service, you only pay for the 150 km one-way journey. Unlike traditional car rentals that charge return fares for empty return journeys, NESAM ensures you save up to 40% to 50% on intercity cab travel.',
      'Our drivers are certified commercial drivers familiar with the ECR route, coastal weather, and local sightseeing spots. Whether travelling for a weekend getaway, corporate meeting, or family holiday, choose from AC Sedans (Dzire/Etios), comfortable 6/7-seater SUVs (Ertiga), or executive Innova Crysta cabs.',
    ],
    keyStops: [
      {
        name: 'Mahabalipuram (Mamallapuram)',
        description: 'UNESCO World Heritage site famous for the Shore Temple, Pancha Rathas, and coastal rock-cut monuments.',
      },
      {
        name: 'Muttukadu Boat House',
        description: 'Scenic backwater kayaking and speed-boating destination just off the ECR highway.',
      },
      {
        name: 'Alamparai Fort Ruins',
        description: 'Historic 18th-century coastal fortress offering sweeping views of the backwaters and sea.',
      },
      {
        name: 'Auroville & Matrimandir',
        description: 'Universal township focused on peace, sustainable living, and the iconic golden Matrimandir.',
      },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 2783, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3570, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3570, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 4725, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'How much is the one-way drop taxi fare from Chennai to Pondicherry?',
        a: 'The one-way drop taxi fare starts from approx ₹2,783 for an AC Sedan (including 150 km distance charge at ₹15/km, ₹400 driver allowance, and 5% GST). Toll charges are payable at actuals against fastag receipts.',
      },
      {
        q: 'Do I have to pay return fare for a one-way trip to Pondicherry?',
        a: 'No. With NESAM one-way drop taxi, you strictly pay for the one-way distance between Chennai and Pondicherry with zero return fare charges.',
      },
      {
        q: 'Can the driver pick me up directly from Chennai Airport (MAA)?',
        a: 'Yes. We provide direct airport pickups from Chennai Domestic and International terminals with meet-and-greet support.',
      },
      {
        q: 'What is the best route between Chennai and Pondicherry?',
        a: 'The East Coast Road (ECR / SH-49) is the preferred scenic coastal route (~150 km, 3 hr 10 min). An alternate route is via GST Road (NH-32) through Tindivanam (~165 km, 3 hr 30 min).',
      },
    ],
  },
  {
    id: 'chennai-bangalore',
    slug: 'chennai-to-bangalore',
    title: 'Chennai to Bangalore Outstation Cab | One Way Drop Taxi Fare',
    h1: 'Chennai to Bangalore One Way Drop Taxi & Outstation Cab',
    origin: 'Chennai',
    destination: 'Bangalore',
    distanceKm: 345,
    duration: '6 hr',
    highway: 'NH-48 via Kanchipuram, Vellore & Hosur',
    pickup: place('p-chn2', 'Chennai Koyambedu', 'Chennai, Tamil Nadu', 13.0694, 80.1948),
    drop: place('d-blr', 'Bangalore Majestic', 'Bengaluru, Karnataka', 12.9767, 77.5713),
    image: '/website-images/web/destinations/route-chennai-bangalore.webp',
    metaDescription:
      'Book Chennai to Bangalore one way cab or outstation round trip with NESAM Cabs. Transparent per km rates, zero return fare, highway drivers, pay via cash or UPI.',
    keywords:
      'chennai to bangalore cab, chennai to bangalore drop taxi, one way taxi chennai to bangalore, cab fare chennai to bangalore, innova crysta chennai to bangalore, outstation cab bangalore',
    summary:
      'Enjoy a stress-free intercity highway journey between Chennai and Bangalore via NH-48. Premium sedans, spacious SUVs, and Innova Crysta cabs with verified commercial highway drivers.',
    overview: [
      'The Chennai to Bangalore expressway corridor is the premier economic transit route in South India, spanning approximately 345 km. Connecting Tamil Nadu’s capital to Karnataka’s IT hub, this highway offers smooth multi-lane driving via Sriperumbudur, Ranipet, Vellore, Krishnagiri, and Hosur.',
      'NESAM Cabs provides guaranteed on-time pickups across Chennai (Koyambedu, T. Nagar, Velachery, OMR, Tambaram, Airport) and seamless drops across Bengaluru (Electronic City, Whitefield, Koramangala, Indiranagar, Majestic, Kempegowda Airport).',
      'Choose our one-way drop taxi to avoid costly return fares, or book an outstation round trip for multi-day business or family commitments.',
    ],
    keyStops: [
      {
        name: 'Vellore Golden Temple (Sripuram)',
        description: 'Magnificent spiritual complex coated with 1,500 kg of pure gold foil, located right off the highway.',
      },
      {
        name: 'Ambur Biryani Hub',
        description: 'World-famous culinary pitstop for authentic Ambur dum biryani and South Indian refreshments.',
      },
      {
        name: 'Krishnagiri Dam & Hills',
        description: 'Peaceful scenic dam reservoir and mango heartland surrounded by lush granite hills.',
      },
      {
        name: 'Hosur Border',
        description: 'Industrial and floral gateway between Tamil Nadu and Karnataka, famous for export-quality roses.',
      },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 5854, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 7665, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 7665, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 10049, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'How long does a cab take from Chennai to Bangalore?',
        a: 'The driving time is approximately 5.5 to 6.5 hours depending on highway traffic and departure time. Early morning departures typically have faster travel times.',
      },
      {
        q: 'How are state permits and highway tolls handled?',
        a: 'Highway tolls and Karnataka state border permits are paid at actual cost against receipts. The core distance charge and driver allowance are included in your quote.',
      },
      {
        q: 'Can I pay the driver at the end of the trip?',
        a: 'Yes. Nothing is charged upfront during online booking. You pay your driver via Cash or UPI (Google Pay, PhonePe, Paytm) upon safe arrival.',
      },
    ],
  },
  {
    id: 'coimbatore-ooty',
    slug: 'coimbatore-to-ooty',
    title: 'Coimbatore to Ooty Cab | Hill Station Taxi & Ghat Road Driver',
    h1: 'Coimbatore to Ooty Hill Station Taxi & Ghat Road Cab',
    origin: 'Coimbatore',
    destination: 'Ooty',
    distanceKm: 88,
    duration: '2 hr 50 min',
    highway: 'NH-181 via Mettupalayam, Coonoor & Nilgiri Ghats',
    pickup: place('p-cbe', 'Coimbatore Gandhipuram', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558),
    drop: place('d-ooty', 'Ooty Charring Cross', 'Udhagamandalam, Tamil Nadu', 11.4102, 76.695),
    image: '/website-images/web/destinations/route-coimbatore-ooty.webp',
    metaDescription:
      'Book Coimbatore to Ooty cab with skilled ghat-road drivers. Clean AC cars, upfront fares, airport & railway station pickup. Experience the Nilgiris comfortably.',
    keywords:
      'coimbatore to ooty cab, coimbatore to ooty taxi fare, coimbatore airport to ooty cab, ooty taxi service, ghat road certified drivers ooty, innova coimbatore to ooty',
    summary:
      'Ascend into the Queen of Hill Stations with experienced ghat-road drivers. Clean AC cars, breathtaking mountain views through Mettupalayam and Coonoor, and guaranteed safety.',
    overview: [
      'The journey from Coimbatore to Ooty (Udhagamandalam) ascends from the Kongu plains into the misty Nilgiri hills. Over 88 km, you navigate the famous Nilgiri ghat road featuring 14 hairpin bends, lush emerald tea plantations, and cool mountain air.',
      'Ghat roads require special hill-driving expertise. Every NESAM driver assigned to Nilgiri trips has verified experience on mountain routes, ensuring your family travels safely without motion sickness or stress.',
      'Whether landing at Coimbatore Airport (CJB) or arriving at Coimbatore Junction railway station, your driver greets you on time and provides comfortable door-to-door transit to your Ooty resort or homestay.',
    ],
    keyStops: [
      {
        name: 'Mettupalayam Foothills',
        description: 'Starting point of the UNESCO Nilgiri Mountain Railway toy train and gateway to the hills.',
      },
      {
        name: 'Coonoor Sim’s Park & Tea Estates',
        description: 'Charming hill town renowned for exquisite botanical varieties, viewpoint cliffs, and fresh Nilgiri tea.',
      },
      {
        name: 'Dolphin’s Nose Viewpoint',
        description: 'Spectacular canyon lookout offering panoramic vistas of Catherine Falls and surrounding peaks.',
      },
      {
        name: 'Ooty Botanical Garden & Lake',
        description: 'Iconic tourist landmarks featuring manicured flora, boating, and equestrian trails.',
      },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 2468, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3150, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3150, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 4179, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'Is AC turned off during ghat road driving?',
        a: 'On steep uphill climbs, AC may be moderated temporarily to maximize engine power and hill stability, in line with standard mountain driving safety protocols.',
      },
      {
        q: 'Can the driver take us for local sightseeing in Ooty and Coonoor?',
        a: 'Yes! You can book an outstation round trip or multi-day package to cover Ooty, Coonoor, Pykara Lake, and Mudumalai sanctuary with the same vehicle and driver.',
      },
      {
        q: 'What is the minimum billing distance for Coimbatore to Ooty outstation cab?',
        a: 'Outstation trips have a standard minimum billing of 130 km for one-way trips, ensuring transparent per-km billing for hill transit.',
      },
    ],
  },
  {
    id: 'madurai-rameshwaram',
    slug: 'madurai-to-rameshwaram',
    title: 'Madurai to Rameshwaram Cab | Pilgrimage Taxi & Pamban Bridge Tour',
    h1: 'Madurai to Rameshwaram Pilgrimage Taxi & Darshan Cab',
    origin: 'Madurai',
    destination: 'Rameshwaram',
    distanceKm: 172,
    duration: '3 hr 30 min',
    highway: 'NH-87 via Manamadurai, Paramakudi & Ramanathapuram',
    pickup: place('p-mdu', 'Madurai Junction', 'Madurai, Tamil Nadu', 9.9252, 78.1198),
    drop: place('d-rsm', 'Rameshwaram Temple', 'Rameswaram, Tamil Nadu', 9.2876, 79.3129),
    image: '/website-images/web/destinations/route-madurai-rameshwaram.webp',
    metaDescription:
      'Book Madurai to Rameshwaram pilgrimage taxi with NESAM Cabs. Visit Ramanathaswamy Temple, Pamban Bridge, and Dhanushkodi with verified courteous drivers.',
    keywords:
      'madurai to rameshwaram taxi, madurai to rameshwaram cab fare, rameshwaram temple taxi, pamban bridge cab, dhanushkodi taxi from madurai, madurai airport to rameshwaram cab',
    summary:
      'Sacred pilgrimage and architectural wonder in one unforgettable journey. Travel across the Pamban Sea Bridge to Sri Ramanathaswamy Temple and Dhanushkodi with verified drivers.',
    overview: [
      'The pilgrimage corridor from Madurai to Rameshwaram connects the sacred city of Goddess Meenakshi to one of the twelve divine Jyotirlinga shrines of Lord Shiva on Pamban Island.',
      'Covering 172 km along NH-87, the highlight of the drive is traversing the iconic Pamban Sea Bridge, where ocean waters lap on both sides of the road. NESAM drivers are familiar with temple darshan timings, sacred theertham bath rituals, and Dhanushkodi beach regulations.',
      'Pickups are available directly from Madurai Airport (IXM), Madurai Meenakshi Temple hotels, and Madurai Junction railway station.',
    ],
    keyStops: [
      {
        name: 'Pamban Sea Bridge',
        description: 'Engineering marvel spanning the ocean, offering spectacular sea vistas and photo opportunities.',
      },
      {
        name: 'Sri Ramanathaswamy Temple',
        description: 'Venerated Jyotirlinga temple famous for its majestic 1,000-pillar corridors and 22 holy kund theerthams.',
      },
      {
        name: 'Dhanushkodi Ghost Town & Sangam',
        description: 'The southeastern tip of India where the Bay of Bengal meets the Indian Ocean, rich in Ramayana history.',
      },
      {
        name: 'APJ Abdul Kalam National Memorial',
        description: 'Inspiring memorial celebrating the life, science, and legacy of India’s former President and missile scientist.',
      },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 3129, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 4032, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 4032, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 5326, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'Can the cab take us all the way to Dhanushkodi?',
        a: 'Yes, modern cabs can proceed along the paved coastal road to Arichal Munai (the southern land’s end). Our drivers know the local beach driving restrictions.',
      },
      {
        q: 'How many days are recommended for Madurai - Rameshwaram tour?',
        a: 'A 2-day round trip allows relaxed temple darshan, holy theertham baths, sunrise/sunset viewing at Dhanushkodi, and return to Madurai.',
      },
      {
        q: 'Are driver boarding codes verified on pilgrimage routes?',
        a: 'Yes. Every booking has a 4-digit boarding code that ensures only your verified driver starts the trip.',
      },
    ],
  },
  {
    id: 'bangalore-mysore',
    slug: 'bangalore-to-mysore',
    title: 'Bangalore to Mysore Cab | 10-Lane Expressway Taxi Booking',
    h1: 'Bangalore to Mysore Expressway Cab & Palace Taxi',
    origin: 'Bangalore',
    destination: 'Mysore',
    distanceKm: 142,
    duration: '2 hr 30 min',
    highway: 'Bengaluru-Mysuru Access-Controlled Expressway (NH-275)',
    pickup: place('p-blr3', 'Bangalore Electronic City', 'Bengaluru, Karnataka', 12.8399, 77.677),
    drop: place('d-mys', 'Mysore Palace', 'Mysuru, Karnataka', 12.3051, 76.6551),
    image: '/website-images/web/destinations/route-chennai-bangalore.webp',
    metaDescription:
      'Book Bangalore to Mysore cab on the 10-lane expressway with NESAM Cabs. Fast 2.5-hour journey, upfront fares, clean AC cars, Mysore Palace and Chamundi Hills drop.',
    keywords:
      'bangalore to mysore cab, bangalore to mysore taxi fare, bangalore mysore expressway cab, bangalore airport to mysore taxi, one way cab bangalore to mysore',
    summary:
      'Cruise down the world-class 10-lane Bengaluru-Mysuru Expressway in total comfort. Reach the City of Palaces in just 2.5 hours with professional highway drivers.',
    overview: [
      'The 142 km Bangalore to Mysore corridor has been transformed by the new access-controlled 10-lane expressway, cutting travel time from 4.5 hours down to just 2.5 hours.',
      'NESAM Cabs provides point-to-point drop taxi and round-trip rentals from all parts of Bengaluru (Electronic City, Koramangala, Whitefield, Indiranagar, Malleshwaram) straight to Mysore Palace, Chamundi Hills, and Brindavan Gardens.',
    ],
    keyStops: [
      { name: 'Ramanagara', description: 'Famous silk city and rock-climbing spot immortalized in Indian cinema.' },
      { name: 'Channapatna', description: 'World-renowned toy town famous for traditional handcrafted wooden lacquer toys.' },
      { name: 'Srirangapatna', description: 'Historic island fortress of Tipu Sultan and Ranganathaswamy Temple.' },
      { name: 'Mysore Palace', description: 'Architectural masterpiece illuminated by nearly 100,000 light bulbs on weekends.' },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 2657, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3402, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3402, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 4507, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'How long does the drive take on the new expressway?',
        a: 'With smooth traffic on the Bengaluru-Mysuru Expressway (NH-275), the journey takes approx 2 to 2.5 hours.',
      },
      {
        q: 'Is two-wheeler traffic allowed on the expressway?',
        a: 'No, the access-controlled expressway is dedicated to four-wheelers and commercial vehicles, guaranteeing a smooth and fast ride.',
      },
    ],
  },
  {
    id: 'trichy-thanjavur',
    slug: 'trichy-to-thanjavur',
    title: 'Trichy to Thanjavur Cab | Heritage Taxi to Big Temple',
    h1: 'Trichy to Thanjavur Heritage Taxi & Big Temple Cab',
    origin: 'Trichy',
    destination: 'Thanjavur',
    distanceKm: 58,
    duration: '1 hr 10 min',
    highway: 'NH-83 via Thuvakudi & Vallam',
    pickup: place('p-trz', 'Trichy Central', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047),
    drop: place('d-tjv', 'Thanjavur Big Temple', 'Thanjavur, Tamil Nadu', 10.787, 79.1378),
    image: '/website-images/web/destinations/destination-thanjavur.webp',
    metaDescription:
      'Book Trichy to Thanjavur cab with NESAM Cabs. Visit UNESCO Brihadisvara Temple, Maratha Palace, and Chola heritage sites with courteous drivers.',
    keywords:
      'trichy to thanjavur cab, trichy to thanjavur taxi fare, trichy airport to thanjavur cab, thanjavur big temple taxi, chola heritage temple tour cab',
    summary:
      'Journey through the fertile Kaveri delta from Trichy’s Rockfort to Thanjavur’s UNESCO World Heritage Brihadisvara Temple in just over an hour.',
    overview: [
      'The short 58 km stretch between Tiruchirappalli (Trichy) and Thanjavur connects the great Chola capital to its architectural crown jewel. Travelling via smooth four-lane NH-83, this is an essential circuit for pilgrims, historians, and tourists.',
      'NESAM Cabs offers prompt airport pickups from Trichy International Airport (TRZ) directly to Thanjavur hotels and heritage resorts.',
    ],
    keyStops: [
      { name: 'Brihadisvara Temple (Big Temple)', description: 'Over 1,000-year-old architectural triumph built by Emperor Raja Raja Chola I.' },
      { name: 'Thanjavur Maratha Palace', description: 'Royal palace housing the Saraswathi Mahal Library and bronze art gallery.' },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 2468, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3150, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3150, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 4179, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'Can the driver pick up from Trichy Airport (TRZ)?',
        a: 'Yes, we provide direct flight arrival pickups from Trichy International Airport with clean AC cars and meet-and-greet service.',
      },
    ],
  },
  {
    id: 'salem-yercaud',
    slug: 'salem-to-yercaud',
    title: 'Salem to Yercaud Cab | Ghat Road Taxi & Hill Station Driver',
    h1: 'Salem to Yercaud Hill Station Taxi & 20 Hairpin Bends Cab',
    origin: 'Salem',
    destination: 'Yercaud',
    distanceKm: 32,
    duration: '1 hr',
    highway: 'SH-188 via 20 Hairpin Bends',
    pickup: place('p-slm', 'Salem Junction', 'Salem, Tamil Nadu', 11.6643, 78.146),
    drop: place('d-ycd', 'Yercaud Lake', 'Yercaud, Tamil Nadu', 11.7753, 78.2093),
    image: '/website-images/web/destinations/destination-coimbatore.webp',
    metaDescription:
      'Book Salem to Yercaud hill station cab with expert ghat road drivers. Ascend the 20 hairpin bends safely to Yercaud Lake, Pagoda Point, and Shevaroy Hills.',
    keywords:
      'salem to yercaud cab, salem to yercaud taxi fare, salem railway station to yercaud cab, yercaud hill taxi, yercaud hairpin bends cab service',
    summary:
      'Quick mountain escape from Salem into the Shevaroy Hills. Navigate the 20 scenic hairpin bends with certified hill-road drivers.',
    overview: [
      'Rising 1,515 metres above sea level, Yercaud is the jewel of the Eastern Ghats. Just 32 km from Salem, the drive takes you through coffee estates, spice plantations, and cool wooded mountain air.',
      'Our drivers are locally trained on the 20 hairpin bends to provide an effortless, smooth ride without abrupt acceleration or braking.',
    ],
    keyStops: [
      { name: 'Yercaud Lake & Boathouse', description: 'Peaceful emerald lake surrounded by gardens and pine forests.' },
      { name: 'Pagoda Point', description: 'Breathtaking ridge viewpoint overlooking Salem town and eastern valleys.' },
      { name: 'Lady’s Seat & Gent’s Seat', description: 'Historic panoramic lookout equipped with viewing telescope.' },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 2468, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3150, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3150, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 4179, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'Is Salem to Yercaud suitable for elderly travellers?',
        a: 'Yes, the climb is only 1 hour and our drivers maintain gentle speeds on the hairpin bends for maximum passenger comfort.',
      },
    ],
  },
  {
    id: 'chennai-tirupati',
    slug: 'chennai-to-tirupati',
    title: 'Chennai to Tirupati Cab | Balaji Temple Pilgrimage & Darshan Taxi',
    h1: 'Chennai to Tirupati Balaji Pilgrimage Taxi & Darshan Cab',
    origin: 'Chennai',
    destination: 'Tirupati',
    distanceKm: 138,
    duration: '3 hr',
    highway: 'NH-716 via Tiruvallur & Tiruttani',
    pickup: place('p-chn3', 'Chennai Koyambedu', 'Chennai, Tamil Nadu', 13.0694, 80.1948),
    drop: place('d-tpt', 'Tirupati Balaji', 'Tirumala, Andhra Pradesh', 13.6833, 79.3472),
    image: '/website-images/web/destinations/destination-chennai.webp',
    metaDescription:
      'Book Chennai to Tirupati Balaji pilgrimage taxi with NESAM Cabs. Same-day round trips, Andhra permit support, early morning pickups for VIP & Seva darshan.',
    keywords:
      'chennai to tirupati cab, chennai to tirupati taxi fare, tirupati balaji temple tour cab, tirumala cab from chennai, chennai airport to tirupati cab',
    summary:
      'Devoted and punctual pilgrimage transit from Chennai to Tirumala Balaji. Clean AC cabs, courteous drivers, and timely arrivals for scheduled temple sevas.',
    overview: [
      'The sacred corridor between Chennai and Tirupati Balaji is one of India’s most visited pilgrimage circuits. Covering 138 km, NESAM Cabs specializes in punctual early-morning pickups to ensure devotees reach Tirupati Alipiri toll or railway station in time for slot darshans.',
      'Our vehicles are fully compliant with Andhra Pradesh inter-state permit requirements, ensuring smooth border crossing with zero unexpected delays.',
    ],
    keyStops: [
      { name: 'Tiruttani Murugan Temple', description: 'One of the six holy abodes (Arupadai Veedu) of Lord Murugan, located en route.' },
      { name: 'Alipiri & Srivari Mettu', description: 'Sacred footpaths and vehicle transit gates leading to Tirumala hilltop.' },
      { name: 'Tirumala Venkateswara Temple', description: 'World-famous temple of Lord Venkateswara nestled in the Seshachalam hills.' },
    ],
    estimates: [
      { category: 'Sedan', seats: '4 Seats', perKm: 15, driverBata: 400, estimatedOneWay: 2594, model: 'Swift Dzire, Toyota Etios' },
      { category: 'SUV 6+1', seats: '6 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3318, model: 'Maruti Ertiga' },
      { category: 'SUV 7+1 / Innova', seats: '7 Seats', perKm: 20, driverBata: 400, estimatedOneWay: 3318, model: 'Toyota Innova' },
      { category: 'Innova Crysta', seats: '7 Seats', perKm: 26, driverBata: 600, estimatedOneWay: 4397, model: 'Toyota Innova Crysta' },
    ],
    faqs: [
      {
        q: 'Can the driver wait while we complete Tirumala darshan?',
        a: 'Yes! Our outstation round-trip packages include full-day driver disposal with waiting while you complete tonsure, theertham, and darshan.',
      },
      {
        q: 'How are Andhra Pradesh border permits handled?',
        a: 'The Andhra state tax/permit is paid online at actual cost against receipts, keeping your journey hassle-free.',
      },
    ],
  },
];

export function findRouteBySlug(slug: string): RouteCorridorDetail | undefined {
  const norm = slug.toLowerCase().replace(/_|\s+/g, '-');
  return ALL_ROUTES.find((r) => r.slug === norm || r.id === norm || norm.replace(/-to-|-/g, '') === r.id.replace(/-/g, ''));
}


// Static, realistic-but-fictional name/content pools for the demo seed.
// No real people, no real phone numbers (all +92 3xx numbers below are
// generated per-driver from a fixed prefix, never a real subscriber range).

export const SHIP_NAMES = [
  'MV Atlantic Horizon',
  'MV Pacific Meridian',
  'MSC Coral Bay',
  'MV Northern Star',
  'MV Karachi Pride',
  'CMA CGM Falcon',
  'MV Indus Voyager',
  'MV Silver Crescent',
  'Maersk Arabian Sea',
  'MV Gulf Navigator',
  'MV Southern Cross',
  'MV Al Bahar',
  'OOCL Horizon',
  'MV Sea Falcon',
  'MV Port Grand',
  'Evergreen Ocean Pearl',
  'MV Coastal Trader',
  'MV Amber Wave',
  'Hapag Lloyd Frontier',
  'MV Blue Meridian',
  'MV Desert Rose',
  'MV Iron Duke',
  'MV Golden Harbor',
  'ONE Falcon Bay',
  'MV Steel Phoenix',
] as const;

export const SHIPPING_COMPANIES = [
  'Orient Star Shipping',
  'Indus Maritime Co.',
  'Continental Freight Lines',
  'Al Noor Shipping Agency',
  'Crescent Ocean Carriers',
  'Bluewater Logistics',
  'Karachi Port Freight Co.',
  'Trans-Indus Shipping',
] as const;

export const DESTINATIONS = [
  'Lahore',
  'Islamabad',
  'Multan',
  'Faisalabad',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Hyderabad',
  'Salalah, Oman',
  'Muscat, Oman',
  'Dubai, UAE',
  'Sukkur',
  'Gwadar',
] as const;

export const TRUCK_TYPES = [
  'Flatbed',
  'Container 20ft',
  'Container 40ft',
  'Refrigerated',
  'Box Truck',
  'Tanker',
  'Low Bed',
] as const;

export const CARGO_TYPES = [
  'General Cargo',
  'Textiles',
  'Machinery',
  'Auto Parts',
  'Perishables',
  'Construction Materials',
  'Electronics',
  'Chemicals (Non-Hazardous)',
] as const;

export const DOCUMENT_TYPES = [
  'CNIC',
  'Driving License',
  'Vehicle Registration',
  'Port Entry Pass',
  'Route Permit',
] as const;

export const DRIVER_FIRST_NAMES = [
  'Daniel',
  'Marcus',
  'Ahsan',
  'Bilal',
  'Zeeshan',
  'Imran',
  'Kashif',
  'Adnan',
  'Faisal',
  'Usman',
  'Hamza',
  'Waqas',
  'Tariq',
  'Shahzad',
  'Nasir',
  'Sohail',
  'Rizwan',
  'Junaid',
  'Asad',
  'Farhan',
  'Naveed',
  'Aamir',
  'Salman',
  'Ali',
  'Omar',
  'Yasir',
  'Zubair',
  'Irfan',
  'Saad',
  'Khurram',
] as const;

export const DRIVER_LAST_NAMES = [
  'Carter',
  'Reed',
  'Raza',
  'Khan',
  'Malik',
  'Ahmed',
  'Iqbal',
  'Sheikh',
  'Butt',
  'Chaudhry',
  'Qureshi',
  'Baig',
  'Awan',
  'Javed',
  'Farooq',
  'Hussain',
  'Abbasi',
  'Nawaz',
  'Siddiqui',
  'Gill',
] as const;

export const LANGUAGES_POOL = ['Urdu', 'English', 'Punjabi', 'Sindhi', 'Pashto', 'Balochi'] as const;

export const CAPACITY_POOL = ['3 ton', '5 ton', '10 ton', '15 ton', '20 ton', '40ft container'] as const;

// Realistic dispatcher-facing demo personas — deliberately fictional, no
// real people. Emails all live under the reserved kinvo-demo.test domain
// (RFC 2606 .test — guaranteed to never resolve to a real address) so a
// reset can safely identify and delete exactly these rows.
export const DEMO_EMAIL_DOMAIN = 'kinvo-demo.test';
export const DEMO_PASSWORD = 'KinvoDemo!2026';

export const PRIMARY_ORG_NAME = 'Gulf Horizon Logistics';
export const SECONDARY_ORG_NAME = 'Meridian Freight Co.';

export const PRIMARY_ORG_PEOPLE = [
  { firstName: 'Ayesha', lastName: 'Raza', role: 'OWNER' as const, slug: 'owner' },
  { firstName: 'Hassan', lastName: 'Malik', role: 'ADMIN' as const, slug: 'admin1' },
  { firstName: 'Sana', lastName: 'Farooq', role: 'ADMIN' as const, slug: 'admin2' },
  // Primary demo login — the account the product demo signs in as. Most
  // dispatcher-attributed activity (ship/driver/assignment creation) is
  // attributed to this user so it isn't a freshly-created empty account.
  { firstName: 'Bilal', lastName: 'Ahmed', role: 'DISPATCHER' as const, slug: 'dispatcher' },
  { firstName: 'Zara', lastName: 'Sheikh', role: 'DISPATCHER' as const, slug: 'dispatcher2' },
  { firstName: 'Usman', lastName: 'Iqbal', role: 'DISPATCHER' as const, slug: 'dispatcher3' },
  { firstName: 'Nadia', lastName: 'Chaudhry', role: 'VIEWER' as const, slug: 'viewer1' },
  { firstName: 'Omar', lastName: 'Baig', role: 'VIEWER' as const, slug: 'viewer2' },
] as const;

export const SECONDARY_ORG_PEOPLE = [
  { firstName: 'Kamran', lastName: 'Siddiqui', role: 'OWNER' as const, slug: 'sec-owner' },
  { firstName: 'Farah', lastName: 'Javed', role: 'DISPATCHER' as const, slug: 'sec-dispatcher' },
] as const;

// The demo login called out in the Data Quality Report — dispatcher@…,
// intentionally surrounded by data rather than a fresh empty account.
export const PRIMARY_DEMO_LOGIN_SLUG = 'dispatcher';

export function demoEmail(slug: string): string {
  return `${slug}@${DEMO_EMAIL_DOMAIN}`;
}

// Realistic-sounding NO_ANSWER/BUSY/UNREACHABLE/WRONG_NUMBER call notes —
// free text, not a fixed enum in the schema, so these are just plausible
// dispatcher/CALL-E-style notes.
export const SOFT_FAILURE_NOTES: Record<'NO_ANSWER' | 'BUSY' | 'UNREACHABLE' | 'WRONG_NUMBER', string[]> = {
  NO_ANSWER: [
    'No answer after 4 rings.',
    'Call rang out, no pickup.',
    'Driver did not answer the call.',
  ],
  BUSY: ['Line was busy.', 'Number reported as busy, will retry.'],
  UNREACHABLE: [
    'Number appears to be switched off.',
    'Could not connect — subscriber unreachable.',
    'Out of network coverage area.',
  ],
  WRONG_NUMBER: [
    'Reached a different person — wrong number on file.',
    'Number no longer belongs to this driver.',
  ],
};

// SYSTEM_ERROR notes matched against escalationClassification.ts's exact
// substrings — must line up exactly with those checks to land in the
// intended LOW/MEDIUM/HIGH bucket.
export const SYSTEM_ERROR_REASONS = {
  HIGH: [
    'CALL-E reported the call as failed due to a provider-side error.',
    'Unrecognized CALL-E call status received from the webhook.',
    'Completed call has no recipients in the provider response.',
    'Completed call has recipient in unexpected status.',
  ],
  MEDIUM: [
    "CALL-E's structured result did not judge the task as completed.",
    'Structured result missing or did not match the expected schema.',
    "Driver's response was classified as unclear by CALL-E.",
  ],
  LOW: [
    'Call was canceled before completion.',
    'Call did not reach a terminal state within the reconciliation window.',
  ],
} as const;

// Short, plausible CONFIRMED/REJECTED transcripts — turn shape matches
// TranscriptTurnDto exactly ({ speaker, text, offsetSeconds }).
export function confirmedTranscript(driverFirstName: string, shipName: string, destination: string) {
  return {
    summary: `${driverFirstName} confirmed the job to ${destination}.`,
    turns: [
      {
        speaker: 'bot' as const,
        text: `Hi, this is Kinvo calling about a load on ${shipName} heading to ${destination}. Are you available?`,
        offsetSeconds: 0,
      },
      { speaker: 'user' as const, text: 'Yes, I can take it. What time?', offsetSeconds: 4.2 },
      {
        speaker: 'bot' as const,
        text: 'Great — please report at the gate at the scheduled time. Confirming you for this job.',
        offsetSeconds: 9.8,
      },
      { speaker: 'user' as const, text: 'Okay, confirmed.', offsetSeconds: 15.1 },
    ],
  };
}

export function rejectedTranscript(driverFirstName: string, destination: string, reason: string) {
  return {
    summary: `${driverFirstName} declined the job to ${destination}: ${reason}`,
    turns: [
      {
        speaker: 'bot' as const,
        text: `Hi, this is Kinvo calling about a load heading to ${destination}. Are you available?`,
        offsetSeconds: 0,
      },
      { speaker: 'user' as const, text: `No, sorry — ${reason}`, offsetSeconds: 3.6 },
      { speaker: 'bot' as const, text: 'Understood, thank you for letting us know.', offsetSeconds: 7.9 },
    ],
  };
}

export const REJECTION_REASONS = [
  'already committed to another job',
  'truck is in for maintenance',
  'too far from current location',
  'rate is too low for this route',
  'not feeling well today',
  'family emergency',
] as const;

export const CANCELLATION_REASONS = [
  'Shipment schedule changed by the shipping line.',
  'Cargo volume reduced, fewer trucks needed.',
  'Ship delayed indefinitely.',
] as const;

export const REMINDER_NOTES = [
  'Please remind confirmed drivers to report 30 minutes early — gate congestion expected.',
  'Reminder call requested ahead of early-morning gate opening.',
  'Weather advisory — confirm drivers are aware of possible delays.',
] as const;

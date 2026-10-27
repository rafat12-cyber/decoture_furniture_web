// Delivery zones and charges, shared by the server (which charges them) and the static catalog
// build (which shows them). The admin panel edits the live copy, stored in the database.

// The 64 districts of Bangladesh, for the checkout address.
export const DISTRICTS = [
  'Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura', 'Brahmanbaria', 'Chandpur', 'Chapai Nawabganj',
  'Chattogram', 'Chuadanga', "Cox's Bazar", 'Cumilla', 'Dhaka', 'Dinajpur', 'Faridpur', 'Feni', 'Gaibandha', 'Gazipur',
  'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore', 'Jhalokati', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna',
  'Kishoreganj', 'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat', 'Madaripur', 'Magura', 'Manikganj', 'Meherpur',
  'Moulvibazar', 'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj', 'Narsingdi', 'Natore', 'Netrokona',
  'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh', 'Patuakhali', 'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati',
  'Rangpur', 'Satkhira', 'Shariatpur', 'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon',
];

// Placeholder charges until Decoture sets its own in Admin > Settings. The first charge covers
// one chair; each extra chair in the same order adds `extra`. The last zone covers every
// district the others do not list.
export const DEFAULT_DELIVERY = {
  zones: [
    { id: 'dhaka', name: 'Inside Dhaka', districts: ['Dhaka'], fee: 300, extra: 100, days: '1 to 2 days' },
    { id: 'near', name: 'Near Dhaka', districts: ['Gazipur', 'Narayanganj', 'Narsingdi', 'Manikganj', 'Munshiganj'], fee: 500, extra: 150, days: '2 to 3 days' },
    { id: 'outside', name: 'Outside Dhaka', districts: [], fee: 800, extra: 200, days: '3 to 5 days' },
  ],
  freeOver: null,
};

export const zoneFor = (delivery, district) =>
  delivery.zones.find((z) => z.districts.includes(district)) || delivery.zones[delivery.zones.length - 1];

export function deliveryCharge(delivery, district, chairs, subtotal) {
  const zone = zoneFor(delivery, district);
  const free = delivery.freeOver != null && subtotal >= delivery.freeOver;
  const fee = free || chairs < 1 ? 0 : zone.fee + zone.extra * (chairs - 1);
  return { zone, fee, free };
}

// Checks a delivery setup sent by the admin panel and returns a clean copy, or a message.
export function cleanDelivery(input) {
  const src = input && Array.isArray(input.zones) ? input : null;
  if (!src || src.zones.length !== DEFAULT_DELIVERY.zones.length) return { error: 'Send all three delivery zones.' };
  const whole = (v, label, max = 100000) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${label} must be a whole number from 0 to ${max}.`);
    return n;
  };
  try {
    const seen = new Set();
    const zones = DEFAULT_DELIVERY.zones.map((def, i) => {
      const z = src.zones[i] || {};
      const last = i === DEFAULT_DELIVERY.zones.length - 1;
      const districts = last ? [] : [...new Set((Array.isArray(z.districts) ? z.districts : []).map(String))];
      for (const d of districts) {
        if (!DISTRICTS.includes(d)) throw new Error(`"${d}" is not a district name.`);
        if (seen.has(d)) throw new Error(`${d} is in two zones.`);
        seen.add(d);
      }
      const name = String(z.name ?? def.name).trim().slice(0, 40) || def.name;
      const days = String(z.days ?? def.days).trim().slice(0, 40);
      return { id: def.id, name, districts, fee: whole(z.fee, `${name} charge`), extra: whole(z.extra, `${name} extra chair charge`), days };
    });
    const freeOver = src.freeOver === null || src.freeOver === '' || src.freeOver === undefined ? null : whole(src.freeOver, 'Free delivery amount', 10_000_000);
    return { delivery: { zones, freeOver } };
  } catch (e) {
    return { error: e.message };
  }
}

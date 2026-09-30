// Regression test for src/lib/maker-reach.ts (run: npx tsx scripts/test_maker_reach.mjs).
// Built from the first real Cut Local request (2026-09-29, Magog, Quebec), which
// reached one maker 2,900 km away who does not ship, and no US maker near the border.
import { reach, countryCode, placeOf, kmBetween, cleanShipCountries } from '../src/lib/maker-reach.ts';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' : ' + extra : ''}`); if (!cond) fails++; };

const magog = { id: 'r1', country: 'Canada', region: 'Québec', city: 'Magog', delivery: 'ship' };
const dean = { id: 'm1', country: 'Canada', region: 'Saskatchewan', city: 'Big river', deliver_radius_km: 300, deliver_domestic_ship: false };
const fm = { id: 'm2', country: 'United States', region: 'NY', city: 'Warwick', deliver_radius_km: 30, deliver_domestic_ship: true };
const tex = { id: 'm3', country: 'United States', region: 'TX', city: 'Quinlan', deliver_radius_km: 15, deliver_domestic_ship: true };
const ray = { id: 'm4', country: 'United States', region: 'KS', city: 'Hill City', deliver_radius_km: 0, deliver_domestic_ship: false };
const lima = { id: 'm5', country: 'USA', region: 'Ohio', city: 'Lima', deliver_radius_km: 0, deliver_domestic_ship: true };
const italy = { id: 'm6', country: 'Italia', region: 'Italia', city: 'Corato', deliver_radius_km: 0, deliver_domestic_ship: false };

ok('country aliases', ['US', 'USA', 'U.S.A.', 'United States', 'united states of america'].every((c) => countryCode(c) === 'US') && countryCode('Italia') === 'IT' && countryCode('Schweiz') === 'CH' && countryCode('Canada') === 'CA');
ok('Quebec with and without the accent', JSON.stringify(placeOf({ country: 'Canada', region: 'Québec' })) === JSON.stringify(placeOf({ country: 'CA', region: 'QC' })));
const kmDean = kmBetween(placeOf(dean), placeOf(magog)), kmFm = kmBetween(placeOf(fm), placeOf(magog));
ok('distances are in the right range', kmDean > 2300 && kmDean < 3200 && kmFm > 350 && kmFm < 700, `Dean ${kmDean} km, Warwick NY ${kmFm} km`);

let r = reach(dean, magog);
ok('Dean: same country, 2,700 km, no shipping -> not shown', !r.show && r.kind === 'far', JSON.stringify(r));
r = reach(fm, magog);
ok('Warwick NY: ships at home, near the border -> ASKED (shown, not sure)', r.show && !r.sure && r.kind === 'border', JSON.stringify(r));
r = reach(tex, magog);
ok('Texas: ships at home but far from Quebec -> not shown', !r.show && r.kind === 'abroad', JSON.stringify(r));
r = reach({ ...fm, ship_countries: ['CA'] }, magog);
ok('a maker who ticked Canada -> sure', r.show && r.sure && r.kind === 'intl');
r = reach({ ...tex, deliver_intl: true }, magog);
ok('ships internationally -> sure', r.show && r.sure && r.kind === 'intl');
r = reach(fm, { ...magog, delivery: 'pickup' });
ok('buyer wants pickup -> no cross-border ask', !r.show);

const usBuyer = { id: 'r2', country: 'United States', region: 'OH', city: 'Dayton', delivery: 'ship' };
r = reach(lima, usBuyer);
ok('"USA" maker vs "United States" buyer is the same country (was a live bug)', r.show && r.sure, JSON.stringify(r));
r = reach(ray, usBuyer);
ok('Kansas maker, no shipping, radius 0, buyer in Ohio -> not shown', !r.show && r.kind === 'far', JSON.stringify(r));
r = reach(ray, { ...usBuyer, city: 'Hill City', region: 'KS' });
ok('same town -> local', r.show && r.sure && r.kind === 'local');
r = reach(ray, { ...usBuyer, region: '', city: '' });
ok('buyer without a state -> kept in as unknown (lenient, as before)', r.show && !r.sure && r.kind === 'unknown');
r = reach(ray, { ...usBuyer, preferred_maker_id: 'm4' });
ok('buyer picked this maker -> always shown', r.show && r.sure && r.kind === 'picked');
r = reach(italy, magog);
ok('Italy vs Quebec -> not shown', !r.show);
ok('ship country list is cleaned', JSON.stringify(cleanShipCountries(['Canada', 'CA', 'usa', 'Narnia', 5])) === JSON.stringify(['CA', 'US']));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

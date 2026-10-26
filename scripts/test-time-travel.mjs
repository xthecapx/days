// Runs the unit suite under several fake clocks/timezones to prove no test depends on the real date.
// Usage: node scripts/test-time-travel.mjs   (npm run test:time-travel)
import { spawnSync } from 'node:child_process';

const SCENARIOS = [
  { FAKE_NOW: '2031-01-01T00:00:00Z', TZ: 'UTC' },
  { FAKE_NOW: '2027-12-31T23:59:30Z', TZ: 'America/Bogota' }, // midnight / New Year during the run
  { FAKE_NOW: '2028-02-29T12:00:00Z', TZ: 'Pacific/Kiritimati' }, // leap day, UTC+14
  { FAKE_NOW: '2026-03-08T06:59:50Z', TZ: 'America/New_York' }, // DST change
];
let failed = false;
for (const env of SCENARIOS) {
  console.log(`\n== FAKE_NOW=${env.FAKE_NOW} TZ=${env.TZ}`);
  const r = spawnSync(process.execPath, ['--import', './tests/support/fake-now.mjs', '--test', '--test-timeout=60000',
    ...['tests/*.test.js', 'services/signal/test/*.test.js']], { env: { ...process.env, ...env, CHROME_PATH: '' }, stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);

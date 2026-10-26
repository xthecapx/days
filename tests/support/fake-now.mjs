/**
 * Test-only preload (`node --import ./tests/support/fake-now.mjs`): moves the process clock to FAKE_NOW (an ISO string)
 * while keeping it ticking, so `new Date()` / `Date.now()` report that instant instead of the real one.
 *
 * It exists to PROVE the suite does not depend on the real clock: scripts/test-time-travel.mjs runs the tests under several
 * fake instants and timezones, including ones where midnight, New Year, a leap day or a DST change happens DURING the run.
 * A test that injects its own time (or uses mock.timers) is unaffected; one that quietly reads the real clock fails here.
 */
const FAKE = process.env.FAKE_NOW;
if (FAKE) {
  const target = Date.parse(FAKE);
  if (Number.isNaN(target)) throw new Error(`FAKE_NOW is not a valid date: ${FAKE}`);
  const RealDate = Date;
  const offset = target - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = FakeDate;
}

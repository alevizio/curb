// The App Store rating ask (ReviewPolicy.swift + ReviewPrompt.swift): only a tap on a REAL sweep alert arms it,
// never on the very first open, at most once per app version. The tag contract with the server always runs; the
// policy itself is compiled and run with swiftc wherever a Swift toolchain exists (macOS with Xcode; GitHub's
// ubuntu runners ship one too), fed the payloads the cron and the "send me a test" endpoint really send.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderOne, VALID_VOICES, VALID_LEVELS } from '../../lib/notify-core.js';

const { default: testNotification } = await import('../../api/test-notification.js');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const POLICY = read('./ReviewPolicy.swift');
const PROMPT = read('./ReviewPrompt.swift');
const APP_DELEGATE = read('./AppDelegate.swift');
const CONTENT_VIEW = read('./ContentView.swift');
const PBX = read('../CURB.xcodeproj/project.pbxproj');
const LISTING = read('../APP-STORE-LISTING.md');
const SENDER = read('../../api/send-notifications.js');

const TAG_PREFIX = POLICY.match(/sweepAlertTagPrefix = "([^"]+)"/)[1];
const TEST_TITLE = POLICY.match(/testTitlePrefix = "([^"]+)"/)[1];
const SPOT = { corridor: 'Haight St', blockside: 'North', nextSweepISO: new Date(Date.now() + 3 * 864e5).toISOString() };

// What a tapped notification hands the app: the payload's `tag` and the alert title.
const realAlerts = () => VALID_VOICES.flatMap((voice) => VALID_LEVELS.flatMap((level) =>
  ['eve', 'morn', 'lead', 'tonight'].map((tp) => { const r = renderOne(SPOT, tp, { voice, level }); return { tag: r.tag, title: r.title }; })));
async function testPushes() {
  const out = [];
  for (const which of ['eve', 'morn', 'lead', 'tonight']) {
    const res = { status() { return this; }, json(b) { this.body = b; return this; } };
    await testNotification({ method: 'POST', body: { which, spot: SPOT }, query: { dryRun: '1' } }, res);
    out.push(...res.body.plan.map((p) => ({ tag: p.tag, title: p.title })));
  }
  // The operator's ?test=ios broadcast (api/send-notifications.js) is a test too.
  const [, title, tag] = SENDER.match(/alert: \{ title: '([^']+)'[^}]*\}[^}]*\}, url: '\/', tag: '(curb-test[^']*)'/);
  out.push({ tag, title });
  return out;
}

describe('rating ask: which taps count', () => {
  it('every real sweep alert carries the tag prefix the app looks for', () => {
    // If notify-core's TAGS are ever renamed, the app would silently never ask again.
    for (const a of realAlerts()) expect(a.tag.startsWith(TAG_PREFIX), a.tag).toBe(true);
  });

  it('no test push does: tagged curb-test, and the "send me a test" titles start with "Test ·"', async () => {
    const tests = await testPushes();
    expect(tests.length).toBeGreaterThanOrEqual(5);
    for (const t of tests) expect(t.tag.startsWith(TAG_PREFIX), t.tag).toBe(false);
    for (const t of tests.slice(0, -1)) expect(t.title.startsWith(TEST_TITLE), t.title).toBe(true);
  });
});

describe('rating ask: wiring and version', () => {
  it('counts opens, reports a tapped alert before routing it, and reports page loads', () => {
    expect(APP_DELEGATE.match(/ReviewPrompt\.shared\.enteredForeground\(\)/g)).toHaveLength(2);   // launch + back from background
    expect(APP_DELEGATE).toMatch(/didEnterBackgroundNotification[\s\S]{0,160}ReviewPrompt\.shared\.enteredBackground\(\)/);
    expect(APP_DELEGATE).toMatch(/ReviewPrompt\.shared\.notificationTapped\(tag: tag, title: title\)\s*\n\s*PushRouter\.shared\.routeNotification/);
    expect(CONTENT_VIEW).toMatch(/didStartProvisionalNavigation[\s\S]{0,200}ReviewPrompt\.shared\.pageStarted\(\)/);
    expect(CONTENT_VIEW).toMatch(/didFinish navigation[\s\S]{0,200}ReviewPrompt\.shared\.pageFinished\(\)/);
    expect(PROMPT).toMatch(/AppStore\.requestReview\(in: scene\)/);
    for (const f of ['ReviewPolicy.swift', 'ReviewPrompt.swift']) expect(PBX).toContain(`/* ${f} in Sources */,`);
  });

  it('every configuration ships one version and build, and the listing has that version\'s What\'s New', () => {
    const versions = [...PBX.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1]);
    const builds = [...PBX.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]);
    expect(versions).toHaveLength(2);
    expect(new Set(versions).size).toBe(1);
    expect(builds).toHaveLength(2);
    expect(new Set(builds).size).toBe(1);
    expect(LISTING).toContain(`## What's New (v${versions[0]})`);
  });
});

// ---- the real Swift policy, compiled and run ----
const HAS_SWIFT = spawnSync('swiftc', ['--version'], { encoding: 'utf8' }).status === 0;
const HARNESS = `import Foundation
struct Alert: Codable { let tag: String?; let title: String? }
struct Ask: Codable { let opens: Int; let askedVersion: String?; let version: String }
struct Input: Codable { let alerts: [Alert]; let asks: [Ask]; let visits: [[String]] }
struct Output: Codable { let alerts: [Bool]; let asks: [Bool]; let opens: [Int] }
let input = try! JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
let out = Output(alerts: input.alerts.map { ReviewPolicy.isSweepAlert(tag: $0.tag, title: $0.title) },
                 asks: input.asks.map { ReviewPolicy.shouldAsk(opens: $0.opens, askedVersion: $0.askedVersion, version: $0.version) },
                 opens: input.visits.map { events in
                     var o = ReviewPolicy.Opens(count: 0)
                     for e in events { if e == "fg" { o.enteredForeground() } else { o.enteredBackground() } }
                     return o.count
                 })
FileHandle.standardOutput.write(try! JSONEncoder().encode(out))
`;

describe.runIf(HAS_SWIFT)('ReviewPolicy.swift, compiled', () => {
  let dir, bin;
  const run = (input) => {
    const r = spawnSync(bin, { input: JSON.stringify({ alerts: [], asks: [], visits: [], ...input }), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'curb-review-'));
    writeFileSync(join(dir, 'main.swift'), HARNESS);
    bin = join(dir, 'policy');
    const src = new URL('./ReviewPolicy.swift', import.meta.url).pathname;
    const c = spawnSync('swiftc', ['-swift-version', '6', '-module-cache-path', join(dir, 'mc'), src, join(dir, 'main.swift'), '-o', bin], { encoding: 'utf8' });
    expect(c.status, c.stderr).toBe(0);
  }, 180_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('arms on every real sweep alert and on no test push or tagless notification', async () => {
    const real = realAlerts(), tests = await testPushes();
    const odd = [
      { tag: null, title: 'Move your car' },                              // no tag: not one of ours
      { tag: 'curb-sweep', title: 'Test · 30 min before (Tue 8:30 AM)' },  // a test title is never a real alert
      { tag: 'curb-sweep-eve', title: null },                             // a real tag with an empty title still counts
    ];
    const { alerts } = run({ alerts: [...real, ...tests, ...odd] });
    expect(alerts.slice(0, real.length).every(Boolean)).toBe(true);
    expect(alerts.slice(real.length, real.length + tests.length).some(Boolean)).toBe(false);
    expect(alerts.slice(-3)).toEqual([false, false, true]);
  });

  it('never asks on the very first open, and at most once per app version', () => {
    const cases = [
      [{ opens: 0, askedVersion: null, version: '1.0.4' }, false],
      [{ opens: 1, askedVersion: null, version: '1.0.4' }, false],     // first open, even from an alert
      [{ opens: 2, askedVersion: null, version: '1.0.4' }, true],
      [{ opens: 9, askedVersion: '1.0.4', version: '1.0.4' }, false],  // already asked in this version
      [{ opens: 9, askedVersion: '1.0.3', version: '1.0.4' }, true],   // a new version may ask again
      [{ opens: 9, askedVersion: null, version: '' }, false],          // no version: never record a bogus one
    ];
    const { asks } = run({ asks: cases.map(([c]) => c) });
    expect(asks).toEqual(cases.map(([, want]) => want));
  });

  it('counts one open per stay in the foreground, however many times iOS signals it', () => {
    // On a cold launch the app counts once itself and iOS then posts willEnterForeground for the same stay: in the
    // simulator that made a first launch read as 2 opens, which would have asked on the very first open.
    const visits = [
      [['fg', 'fg'], 1],                      // cold launch + the launch's own willEnterForeground
      [['fg', 'fg', 'bg', 'fg'], 2],          // then away and back
      [['fg', 'bg', 'fg', 'fg', 'bg', 'bg', 'fg'], 3],
    ];
    const { opens } = run({ visits: visits.map(([v]) => v) });
    expect(opens).toEqual(visits.map(([, want]) => want));
  });
});

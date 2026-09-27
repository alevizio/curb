// The JavaScript the iOS app injects into curb.guide lives in ContentView.swift as Swift multi-line string
// literals (`private static let <name> = WKUserScript(source: """ … """`). This pulls them out as runnable
// JS so tests can exercise the real bridge code: ios/CURB/ContentView.test.mjs and scripts/check-locate.mjs.
const SWIFT_ESCAPES = { '\\': '\\', n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", 0: '\0' };

export function userScripts(swiftSource) {
  const out = {};
  const re = /private static let (\w+) = WKUserScript\(\s*source: """\n([\s\S]*?)\n\s*""",/g;
  for (const [, name, body] of swiftSource.matchAll(re)) {
    out[name] = body.replace(/\\(.)/g, (m, c) => (c in SWIFT_ESCAPES ? SWIFT_ESCAPES[c] : m));
  }
  return out;
}

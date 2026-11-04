import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Execute the actual copied JavaScript, comparing endpoints, interpolation and clamps
// with the Python application, rather than duplicating the mapping algorithm in a test.
test('copied JavaScript maps match Python on unseen probabilities', () => {
  const fixtures = JSON.parse(execFileSync('python3', ['-c', `
import json
from jev import recalibrate as r
pairs = [(0.1, False), (0.2, True), (0.3, False), (0.6, True), (0.9, True)]
ps = [0, 0.001, 0.15, 0.25, 0.4, 0.75, 0.99, 1]
print(json.dumps([{'source': r.source(m)['javascript'], 'ps': ps,
                   'expected': [r.apply(m, p) for p in ps]}
                  for m in [{'method': 'raw'}, r.platt(pairs), r.isotonic(pairs)]]))
`], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }));
  for (const fixture of fixtures) {
    const calibrated = new Function(`${fixture.source}; return calibrated;`)();
    fixture.ps.forEach((p, i) => assert.ok(Math.abs(calibrated(p) - fixture.expected[i]) < 1e-12));
  }
});

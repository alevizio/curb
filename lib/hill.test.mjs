// The hill reminder's words: which way a car faces on each side, and that the alert never guesses a side.
import { describe, it, expect } from 'vitest';
import './hill.js';
const { hillAdvice, hillAlert } = globalThis;

// The block behind this feature: Buena Vista Ave West, Central to Waller. Its line runs downhill, the even side (838) is L.
const BUENA_VISTA = [88, -1, 'B'];

describe('hillAdvice', () => {
  it('gives no card without an entry', () => {
    expect(hillAdvice(undefined, 'L')).toBeNull();
  });

  it('on a two way street, tells the two sides apart', () => {
    const even = hillAdvice(BUENA_VISTA, 'L'), odd = hillAdvice(BUENA_VISTA, 'R');
    expect(even.title).toBe('Steep block, 8.8%');
    expect(even.main).toBe('Facing uphill on this side: wheels away from the curb, then let the car roll back until the tire touches it. Set the parking brake.');
    expect(even.other).toBe('Facing downhill? Wheels toward the curb.');
    expect(even.rule).toBe('SF requires this over 3%. Ticket: $48.');
    expect(odd.main).toBe('Facing downhill on this side: wheels toward the curb. Set the parking brake.');
    expect(odd.other).toBe('Facing uphill? Wheels away from the curb, then let the car roll back until the tire touches it.');
  });

  it('on a one way street, both sides face the way traffic runs', () => {
    for (const lr of ['L', 'R', '']) {
      expect(hillAdvice([60, 1, 'F'], lr).main).toMatch(/^Facing uphill on this side/);    // with a rising line
      expect(hillAdvice([60, 1, 'T'], lr).main).toMatch(/^Facing downhill on this side/);  // against a rising line
      expect(hillAdvice([60, -1, 'F'], lr).main).toMatch(/^Facing downhill on this side/);
      expect(hillAdvice([60, -1, 'T'], lr).main).toMatch(/^Facing uphill on this side/);
    }
  });

  it('gives both moves when it cannot say which way the car faces', () => {
    const both = 'Facing downhill: wheels toward the curb. Facing uphill: wheels away from the curb, then let the car roll back until the tire touches it. Set the parking brake.';
    for (const [entry, lr] of [[[60, 0, 'B'], 'L'], [[60, 0, 'F'], 'R'], [[60, 1, ''], 'L'], [[60, 1, 'B'], ''], [[60, 1, 'B'], undefined]]) {
      const h = hillAdvice(entry, lr);
      expect(h.main).toBe(both);
      expect(h.other).toBe('');
    }
  });

  it('says which way the car faces, for the card to draw it', () => {
    expect(hillAdvice(BUENA_VISTA, 'L').facing).toBe('uphill');
    expect(hillAdvice(BUENA_VISTA, 'R').facing).toBe('downhill');
    expect(hillAdvice([60, 0, 'B'], 'L').facing).toBeNull();
  });

  it('puts the curb on the left only on the left side of a one way street', () => {
    const curb = (way, lr) => hillAdvice([60, 1, way], lr).curb;
    expect(curb('F', 'L')).toBe('left');   // traffic with the line: its left is the line's left
    expect(curb('T', 'R')).toBe('left');   // traffic against the line: its left is the line's right
    expect(curb('F', 'R')).toBe('right');
    expect(curb('T', 'L')).toBe('right');
    expect(curb('B', 'L')).toBe('right');  // a two way street keeps each side's traffic on the curb
    expect(curb('B', 'R')).toBe('right');
    expect(curb('', 'L')).toBe('right');
  });

  it('under the 3% rule, says close to it instead of steep', () => {
    const h = hillAdvice([28, 1, 'B'], 'R');
    expect(h.title).toBe('Sloped block, 2.8%');
    expect(h.rule).toBe("Close to SF's 3% limit, so curb them anyway. Ticket: $48.");
    expect(hillAdvice([30, 1, 'B'], 'R').title).toBe('Sloped block, 3.0%');
    expect(hillAdvice([31, 1, 'B'], 'R').title).toBe('Steep block, 3.1%');
  });
});

describe('hillAlert', () => {
  it('gives no sentence without an entry', () => {
    expect(hillAlert(undefined)).toBeNull();
  });

  it('never picks a move on a two way street: GPS cannot tell the side', () => {
    expect(hillAlert(BUENA_VISTA)).toBe('Steep block. Facing downhill: wheels toward the curb. Facing uphill: wheels away, tire touching it.');
  });

  it('gives the one move on a one way street', () => {
    expect(hillAlert([60, 1, 'F'])).toBe('Steep block: wheels away from the curb, tire touching it.');
    expect(hillAlert([60, 1, 'T'])).toBe('Steep block: wheels toward the curb.');
    expect(hillAlert([28, -1, 'T'])).toBe('Sloped block: wheels away from the curb, tire touching it.');
  });

  it('gives both moves on a block that climbs and drops', () => {
    expect(hillAlert([60, 0, 'F'])).toMatch(/Facing downhill: .* Facing uphill: /);
  });
});

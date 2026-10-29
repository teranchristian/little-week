import assert from 'node:assert/strict';
import test from 'node:test';
import { fitImageScale } from '../src/customIcons.ts';

test('100% fits the entire image inside a square preview and saved icon', () => {
  for (const squareSize of [240, 128]) {
    for (const [width, height] of [[400, 200], [200, 400], [300, 300]]) {
      const scale = fitImageScale(width, height, squareSize);
      assert.equal(Math.max(width * scale, height * scale), squareSize);
      assert.ok(width * scale <= squareSize && height * scale <= squareSize);
    }
  }
});

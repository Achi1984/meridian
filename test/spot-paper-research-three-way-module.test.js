import test from "node:test";
import assert from "node:assert/strict";
import { compareThreeSpotPaperStrategies } from
  "../scripts/spot-paper-research/three-way-comparison.mjs";

test("additive three-way comparison module preserves bounded input contract", () => {
  assert.equal(typeof compareThreeSpotPaperStrategies, "function");
  assert.throws(() => compareThreeSpotPaperStrategies([]),
    /OBSERVATION_COUNT_LIMIT/);
});

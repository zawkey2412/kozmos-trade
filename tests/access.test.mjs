import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessProblem, squaresBetween } from "../scripts/engine/access.mjs";

const box = (x, y, size = 1) => ({ x, y, width: size, height: size });
const open = { enabled: true, open: true, now: 1000, bannedUntil: undefined, attitude: 0, refuseAt: -40, squares: null, maxSquares: null };

describe("distance between tokens", () => {
  it("is 1 square when tokens touch, side or corner", () => {
    assert.equal(squaresBetween(box(0, 0), box(100, 0), 100), 1);
    assert.equal(squaresBetween(box(0, 0), box(100, 100), 100), 1);
  });

  it("counts empty squares between, diagonals as one", () => {
    assert.equal(squaresBetween(box(0, 0), box(200, 0), 100), 2);
    assert.equal(squaresBetween(box(0, 0), box(300, 300), 100), 3);
  });

  it("measures from the edge of a large token", () => {
    assert.equal(squaresBetween(box(0, 0, 2), box(300, 0), 100), 2);
  });

  it("is 1 when tokens overlap", () => {
    assert.equal(squaresBetween(box(0, 0), box(50, 0), 100), 1);
  });
});

describe("access checks", () => {
  it("lets a customer into an open shop", () => {
    assert.equal(accessProblem(open), null);
  });

  it("refuses when the actor is not a shop, or is closed", () => {
    assert.equal(accessProblem({ ...open, enabled: false }), "KT.Error.NotShop");
    assert.equal(accessProblem({ ...open, open: false }), "KT.Error.Closed");
  });

  it("refuses a customer banned until later today", () => {
    assert.equal(accessProblem({ ...open, bannedUntil: 2000 }), "KT.Error.Banned");
    assert.equal(accessProblem({ ...open, bannedUntil: 1000 }), null);
  });

  it("refuses at attitude -40 or lower, unless attitude is off", () => {
    assert.equal(accessProblem({ ...open, attitude: -39 }), null);
    assert.equal(accessProblem({ ...open, attitude: -40 }), "KT.Error.Refuses");
    assert.equal(accessProblem({ ...open, attitude: null }), null);
  });

  it("asks the customer to come closer when proximity is on", () => {
    assert.equal(accessProblem({ ...open, squares: 2, maxSquares: 2 }), null);
    assert.equal(accessProblem({ ...open, squares: 3, maxSquares: 2 }), "KT.Error.TooFar");
    assert.equal(accessProblem({ ...open, squares: null, maxSquares: 2 }), "KT.Error.TooFar");
  });
});

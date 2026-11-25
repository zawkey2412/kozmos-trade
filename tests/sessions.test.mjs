import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstSession } from "../scripts/services/sessions.mjs";

describe("answering window", () => {
  it("is the window that opened first", () => {
    const sessions = [
      { id: "b", since: 200 },
      { id: "a", since: 100 },
      { id: "c", since: 300 },
    ];
    assert.equal(firstSession(sessions).id, "a");
  });

  it("breaks a tie by id, the same way in every window", () => {
    const sessions = [
      { id: "zz", since: 100 },
      { id: "kk", since: 100 },
    ];
    assert.equal(firstSession(sessions).id, "kk");
    assert.equal(firstSession([...sessions].reverse()).id, "kk");
  });

  it("is the only window when there is one", () => {
    assert.equal(firstSession([{ id: "solo", since: 5 }]).id, "solo");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeyedQueue } from "../scripts/services/queue.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("merchant queue", () => {
  it("runs one merchant's tasks one at a time, in order", async () => {
    const queue = new KeyedQueue();
    const log = [];
    const task = (name, ms) => async () => {
      log.push(`start ${name}`);
      await wait(ms);
      log.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([queue.run("anvil", task("a", 20)), queue.run("anvil", task("b", 1))]);
    assert.deepEqual(results, ["a", "b"]);
    assert.deepEqual(log, ["start a", "end a", "start b", "end b"]);
  });

  it("lets two buyers race for the last potion without both getting it", async () => {
    const queue = new KeyedQueue();
    let stock = 1;
    const buy = () => async () => {
      const left = stock;
      await wait(5);
      if (left < 1) return false;
      stock = left - 1;
      return true;
    };
    const bought = await Promise.all([queue.run("potions", buy()), queue.run("potions", buy())]);
    assert.deepEqual(bought, [true, false]);
    assert.equal(stock, 0);
  });

  it("runs different merchants side by side", async () => {
    const queue = new KeyedQueue();
    const log = [];
    const task = (name, ms) => async () => {
      log.push(`start ${name}`);
      await wait(ms);
      log.push(`end ${name}`);
    };
    await Promise.all([queue.run("anvil", task("anvil", 20)), queue.run("temple", task("temple", 1))]);
    assert.deepEqual(log, ["start anvil", "start temple", "end temple", "end anvil"]);
  });

  it("keeps going after a task fails", async () => {
    const queue = new KeyedQueue();
    const failed = queue.run("anvil", () => {
      throw new Error("out of stock");
    });
    const next = queue.run("anvil", () => "sold");
    await assert.rejects(failed, /out of stock/);
    assert.equal(await next, "sold");
  });

  it("is idle once a merchant's tasks are done", async () => {
    const queue = new KeyedQueue();
    const done = queue.run("anvil", () => wait(5));
    assert.equal(queue.busy("anvil"), true);
    await done;
    await wait(0);
    assert.equal(queue.busy("anvil"), false);
  });
});

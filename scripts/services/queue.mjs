// Runs tasks one at a time for each key, in the order they arrive.
export class KeyedQueue {
  /** @type {Map<string, Promise<void>>} */
  #tails = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {() => T | Promise<T>} task
   * @returns {Promise<T>}
   */
  run(key, task) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.then(
      () => {},
      () => {},
    );
    this.#tails.set(key, tail);
    tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }

  /** @param {string} key */
  busy(key) {
    return this.#tails.has(key);
  }
}

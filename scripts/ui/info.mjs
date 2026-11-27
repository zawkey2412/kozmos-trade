// The question mark beside a field: a click on it never reaches the field its label belongs to.
export function registerInfoHints() {
  document.addEventListener("click", (event) => {
    if (/** @type {HTMLElement} */ (event.target).closest?.(".kt-info")) event.preventDefault();
  }, true);
}

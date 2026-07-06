/* fastTab.js — gives BC "FastTab" collapse/expand behaviour to detail/form sections.
   Safe by design: it only wires cards that already have a heading, and toggles a CSS
   class (.collapsed) — no markup is moved or removed, so it can't break a card that
   doesn't fit the pattern. Runs on a delegated click so it works for content rendered
   after load (modals, tab switches). */
(function () {
  if (window.APP_CONFIG && window.APP_CONFIG.bcStructure === false) return;

  document.addEventListener('click', function (ev) {
    const head = ev.target.closest('body.bc-struct .info-card > h3:first-child, body.bc-struct .info-card > .info-card-head:first-child');
    if (!head) return;
    const card = head.parentElement;
    if (!card || !card.classList.contains('info-card')) return;
    // Don't collapse when the click was on an interactive control inside the header.
    if (ev.target.closest('button, a, input, select, .badge')) return;
    card.classList.toggle('collapsed');
  });
})();

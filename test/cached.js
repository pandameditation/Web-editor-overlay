/*
 * The pattern no file comparison can catch.
 *
 * The text starts in the HTML, so every structural signal correctly reports it as
 * authored. The code caches it into an attribute and re-renders from that attribute on
 * the next interaction — so an in-place edit is genuinely lost, and nothing about where
 * the text *came from* could have predicted it.
 *
 * Modelled on real code:
 *   var text = el.getAttribute('data-text');
 *   if (text === null) { text = el.textContent; el.setAttribute('data-text', text); }
 */
(function () {
  'use strict';

  function cache(el) {
    var text = el.getAttribute('data-text');
    if (text === null) {
      text = el.textContent;
      el.setAttribute('data-text', text);
    }
    return text;
  }

  var target = document.getElementById('cached-copy');
  cache(target);

  // What a scroll handler, a resize, or a re-layout would do later.
  window.rerenderFromCache = function () {
    target.textContent = target.getAttribute('data-text');
  };
}());

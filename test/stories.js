/*
 * A list built from data and written in with `innerHTML`, by a script that runs while
 * the document is still parsing — which is to say before any editor could be watching.
 * Modelled on a real page, including the nesting: the text worth clicking on is three
 * levels below the element the write landed on.
 */
(function () {
  'use strict';

  var stories = [
    { 'story-num': 1, 'story-slug': 'leading', 'story-title': 'Leading', 'story-meta': 'Desc one', url: 'leading.html' },
    { 'story-num': 2, 'story-slug': 'trailing', 'story-title': 'Trailing', 'story-meta': 'Desc two', url: 'trailing.html' },
  ];

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderStoryCard(story) {
    return '<a class="story" href="' + escapeHtml(story.url) +
      '" id="' + escapeHtml(story['story-slug']) + '">' +
      '<span class="story-num">Story ' + String(story['story-num']).padStart(2, '0') + '</span>' +
      '<h3 class="story-title">' + escapeHtml(story['story-title']) + '</h3>' +
      '<p class="story-meta">' + escapeHtml(story['story-meta']) + '</p>' +
      '</a>';
  }

  function renderStories(container, list) {
    container.innerHTML = list.map(renderStoryCard).join('');
  }

  renderStories(document.getElementById('all-stories'), stories);
}());

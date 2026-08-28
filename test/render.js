/*
 * The page's own script. Everything it writes here is content the editor must refuse
 * to edit in place, and each write uses a different DOM API so the wrappers are
 * exercised rather than assumed.
 */
const heading = document.getElementById('js-heading');
heading.textContent = 'Rendered by JavaScript';

const list = document.getElementById('js-list');
list.innerHTML = '<li class="row">First from innerHTML</li><li class="row">Second from innerHTML</li>';

const appended = document.createElement('p');
appended.id = 'js-appended';
appended.textContent = 'Appended after load';
document.getElementById('js-host').appendChild(appended);

const counted = document.getElementById('js-counted');
counted.textContent = `Total: ${2 + 3} items`;

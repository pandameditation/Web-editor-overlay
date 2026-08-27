/*
 * The external script.
 *
 * It has already run by the time the editor exists, so editing it can never change
 * the page — only the file. That asymmetry is the reason a whole-file replacement is
 * the only honest thing to write here.
 */
document.documentElement.dataset.writebackScriptRan = 'yes';

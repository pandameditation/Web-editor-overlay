/*
 * An external script, present so the export has one to decide about.
 *
 * It marks the document so the fixture can prove the script ran, and it is deliberately
 * boring otherwise: what is being tested is whether its *text* travels, not what it does.
 */
document.documentElement.dataset.bundleScriptRan = 'yes';

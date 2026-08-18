/**
 * HtmlEditorOverlay
 * A dependency-free, injectable editor for existing HTML documents.
 *
 * Usage: HtmlEditorOverlay.mount({ fileName: "edited-page.html" });
 * It never mounts automatically. Changes are made in place and can be undone.
 * The editor UI lives in a ShadowRoot when available so page CSS cannot leak in.
 */
(function (global) {
  "use strict";

  if (!global || !global.document) return;
  if (global.HtmlEditorOverlay && global.HtmlEditorOverlay.__instance) {
    try { global.HtmlEditorOverlay.unmount(); } catch (_) {}
  }

  function safeURL(value, media) {
    var url = String(value == null ? "" : value).trim();
    if (!url || /^\s*(?:javascript|vbscript):/i.test(url)) return "";
    if (/^\s*data:/i.test(url)) {
      if (media && /^data:image\/(?:gif|jpeg|png|webp|avif|svg\+xml);/i.test(url)) return url;
      return "";
    }
    if (/^(?:#|\?|\/|\.{1,2}\/)/.test(url)) return url;
    try {
      var parsed = new global.URL(url, doc.baseURI);
      if (/^(?:https?:|mailto:|tel:|blob:|file:)$/.test(parsed.protocol)) return url;
    } catch (_) {}
    return "";
  }

  var doc = global.document;
  var VERSION = "1.1.2";
  var instance = null;
  var uid = 0;

  var STYLE = [
    ":host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;color:#15202b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;font-size:13px;line-height:1.4;}",
    "*,*::before,*::after{box-sizing:border-box;}",
    ".he-ui{position:fixed;inset:0;pointer-events:none;}",
    ".he-ui button,.he-ui input,.he-ui select,.he-ui textarea{font:inherit;}",
    ".he-ui button{border:0;cursor:pointer;}",
    ".he-hover{position:fixed;pointer-events:none;border:1px solid rgba(80,130,255,.56);background:rgba(80,130,255,.06);border-radius:3px;transition:opacity .12s;}",
    ".he-selection{position:fixed;pointer-events:none;border:1.5px solid #356dff;border-radius:4px;box-shadow:0 0 0 3px rgba(53,109,255,.11);}",
    ".he-selection-label{position:absolute;left:-1px;top:-25px;background:#356dff;color:#fff;border-radius:5px 5px 0 0;padding:4px 7px;font-size:11px;white-space:nowrap;box-shadow:0 3px 8px #356dff33;}",
    ".he-handle{position:absolute;width:12px;height:12px;background:#fff;border:1.5px solid #356dff;border-radius:3px;pointer-events:auto;padding:0;box-shadow:0 1px 3px #16306a44;}",
    ".he-handle:focus-visible{outline:2px solid #192438;outline-offset:2px}.he-handle[data-pos=\"nw\"]{left:-7px;top:-7px;cursor:nwse-resize}.he-handle[data-pos=\"n\"]{left:calc(50% - 6px);top:-7px;cursor:ns-resize}.he-handle[data-pos=\"ne\"]{right:-7px;top:-7px;cursor:nesw-resize}.he-handle[data-pos=\"e\"]{right:-7px;top:calc(50% - 6px);cursor:ew-resize}.he-handle[data-pos=\"se\"]{right:-7px;bottom:-7px;cursor:nwse-resize}.he-handle[data-pos=\"s\"]{left:calc(50% - 6px);bottom:-7px;cursor:ns-resize}.he-handle[data-pos=\"sw\"]{left:-7px;bottom:-7px;cursor:nesw-resize}.he-handle[data-pos=\"w\"]{left:-7px;top:calc(50% - 6px);cursor:ew-resize}",
    ".he-toolbar,.he-panel,.he-dialog{pointer-events:auto;background:rgba(255,255,255,.98);border:1px solid #dfe5ef;box-shadow:0 16px 40px #13213b1f,0 2px 8px #13213b12;backdrop-filter:blur(15px);}",
    ".he-toolbar{position:fixed;display:flex;align-items:center;gap:3px;padding:5px;border-radius:10px;min-height:42px;max-width:calc(100vw - 20px);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;}",
    ".he-toolbar::-webkit-scrollbar{display:none}.he-toolbar button,.he-divider{flex:0 0 auto;}",
    ".he-toolbar button,.he-icon-button{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 8px;border-radius:6px;background:transparent;color:#39475b;font-size:12px;white-space:nowrap;}",
    ".he-toolbar button:hover,.he-icon-button:hover{background:#edf2fb;color:#1849b5}.he-toolbar button:disabled,.he-actions button:disabled{cursor:not-allowed;opacity:.45}.he-toolbar button:focus-visible,.he-panel button:focus-visible,.he-dialog button:focus-visible,.he-panel input:focus-visible,.he-panel select:focus-visible,.he-panel textarea:focus-visible{outline:2px solid #356dff;outline-offset:2px;}",
    ".he-divider{height:23px;width:1px;background:#e5e9f1;margin:0 2px}.he-primary{background:#356dff!important;color:white!important}.he-danger{color:#c43b49!important}.he-status{font-size:11px;color:#748198;padding:0 7px;white-space:nowrap;}",
    ".he-panel{position:fixed;right:14px;top:14px;bottom:14px;width:320px;max-width:calc(100vw - 28px);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;pointer-events:auto;}",
    ".he-panel-header{display:flex;align-items:flex-start;justify-content:space-between;padding:13px 14px 11px;border-bottom:1px solid #e8ecf3;cursor:move;touch-action:none}.he-panel-header:focus-visible{outline:2px solid #356dff;outline-offset:-2px}.he-panel-title{font-weight:700;font-size:14px;color:#172235}.he-panel-subtitle{font-size:11px;color:#8490a2;margin-top:3px;max-width:235px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.he-panel-drag-hint{font-size:10px;color:#9aa5b5;margin-top:4px}.he-panel-body{padding:14px 16px;overflow:auto}.he-section{padding-bottom:16px;margin-bottom:15px;border-bottom:1px solid #edf0f5}.he-section:last-child{border-bottom:0}.he-section h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7b879b;margin:0 0 9px}.he-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.he-field{display:flex;flex-direction:column;gap:5px;margin-bottom:9px}.he-field label{font-size:11px;color:#66748b}.he-field input,.he-field select,.he-field textarea{width:100%;border:1px solid #d8dfeb;border-radius:6px;background:#fff;color:#1d2b40;padding:7px 8px;min-height:32px}.he-field textarea{min-height:70px;resize:vertical}.he-field input[type=\"color\"]{padding:2px;height:32px}.he-field input[type=\"checkbox\"]{width:auto;min-height:auto}.he-check{display:flex;align-items:center;gap:7px;font-size:12px;color:#526078;margin:5px 0}.he-note{font-size:11px;line-height:1.5;color:#7a8798;background:#f7f9fc;padding:9px;border-radius:7px}.he-actions{display:flex;gap:7px;flex-wrap:wrap}.he-actions button{border:1px solid #d9e0eb;border-radius:6px;padding:7px 10px;background:#fff;color:#33435a}.he-actions button:hover{background:#f3f6fb}.he-empty{padding:25px 2px;color:#7d8999;font-size:12px;line-height:1.55}.he-token-note{font-size:10px;color:#7c8798;margin:-4px 0 7px}.he-insert-dialog{width:min(520px,100%);max-height:min(78vh,650px);overflow:auto}.he-library-entry{border:1px solid #e1e7f0;border-radius:9px;padding:11px;margin:9px 0}.he-library-entry h3{font-size:13px;margin:0 0 3px}.he-library-entry p{font-size:11px;color:#718097;margin:0 0 8px}.he-library-actions{display:flex;justify-content:flex-end;margin-top:10px}.he-preview-badge{position:fixed;right:14px;bottom:14px;display:flex;align-items:center;gap:6px;background:#192438;color:#fff;border-radius:9px;padding:5px 7px 5px 9px;box-shadow:0 5px 16px #13213b33;pointer-events:auto;touch-action:none}.he-preview-grip{font-size:11px;color:#aebbd0;cursor:move;padding:3px}.he-preview-badge button{height:28px;padding:0 9px;border-radius:6px;background:#356dff;color:#fff}.he-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
    ".he-dialog-wrap{position:fixed;inset:0;background:#15223b42;display:flex;align-items:center;justify-content:center;pointer-events:auto;padding:20px}.he-dialog{width:390px;max-width:100%;border-radius:13px;padding:19px}.he-dialog h2{font-size:16px;margin:0 0 8px}.he-dialog p{color:#5e6b7e;line-height:1.55;margin:0 0 13px}.he-dialog .he-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:17px}.he-dialog .he-dialog-actions button{border-radius:7px;padding:8px 13px;background:#eef2f8;color:#35445a}.he-dialog .he-dialog-actions .he-primary{background:#356dff;color:#fff}.he-dialog .he-dialog-actions .he-danger{background:#fff0f1;border:1px solid #f1c8cc}.he-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#192438;color:#fff;border-radius:8px;padding:9px 13px;box-shadow:0 7px 20px #13213b33;pointer-events:auto;font-size:12px;}",
    ".he-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
    "@media(max-width:700px){.he-panel{top:auto;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));width:auto;max-height:70vh}.he-toolbar{left:8px!important;right:8px;bottom:calc(70vh + 18px);top:auto!important;overflow:auto}.he-status{display:none}}"
  ].join("");

  function create(tag, attrs, text) {
    var el = doc.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === "className") el.className = attrs[key];
      else if (key === "textContent") el.textContent = attrs[key];
      else if (key === "on") Object.keys(attrs[key]).forEach(function (event) { el.addEventListener(event, attrs[key][event]); });
      else if (key === "style") Object.assign(el.style, attrs[key]);
      else if (attrs[key] !== false && attrs[key] != null) el.setAttribute(key, attrs[key] === true ? "" : attrs[key]);
    });
    if (text != null) el.textContent = text;
    return el;
  }

  function installStyles(shadow) {
    if (shadow && "adoptedStyleSheets" in shadow && global.CSSStyleSheet) {
      try {
        var sheet = new global.CSSStyleSheet();
        sheet.replaceSync(STYLE);
        shadow.adoptedStyleSheets = Array.prototype.slice.call(shadow.adoptedStyleSheets || []).concat(sheet);
        return;
      } catch (_) {}
    }
    var style = doc.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);
  }

  function closestElement(node, predicate) {
    while (node && node !== doc) {
      if (node.nodeType === 1 && predicate(node)) return node;
      node = node.parentNode || (node.host && node.host);
    }
    return null;
  }

  function isEditorNode(el) {
    if (!instance || !el) return false;
    if (el === instance.host) return true;
    if (typeof el.nodeType !== "number") return false;
    try { return !!(instance.shadow && instance.shadow.contains && instance.shadow.contains(el)); } catch (_) { return false; }
  }

  function isCandidate(el) {
    if (!el || el.nodeType !== 1 || isEditorNode(el)) return false;
    if (el.getRootNode && el.getRootNode() !== doc) return false;
    var tag = el.tagName.toLowerCase();
    return tag !== "html" && tag !== "head" && tag !== "script" && tag !== "style" &&
      tag !== "meta" && tag !== "link" && tag !== "title" && tag !== "br";
  }

  function isNativeEditingTarget(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== doc) {
      var tag = el.tagName && el.tagName.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" ||
          el.isContentEditable || el.hasAttribute && el.hasAttribute("contenteditable")) return true;
      el = el.parentElement || (el.host && el.host);
    }
    return false;
  }

  function isNativeEditingEvent(event) {
    var path = event && event.composedPath ? event.composedPath() : [event && event.target];
    return path.some(isNativeEditingTarget);
  }

  function pathFor(el) {
    if (!el || !el.parentNode) return null;
    var path = [];
    var node = el;
    while (node && node !== doc.documentElement) {
      var parent = node.parentElement;
      if (!parent) break;
      path.unshift(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return path;
  }

  function elementAt(path) {
    if (!path) return null;
    var node = doc.documentElement;
    for (var i = 0; i < path.length; i++) {
      node = node && node.children[path[i]];
      if (!node) return null;
    }
    return node;
  }

  function directText(el) {
    var parts = [];
    Array.prototype.forEach.call(el.childNodes || [], function (node) {
      if (node.nodeType === 3 && node.nodeValue.trim()) parts.push(node.nodeValue);
    });
    return parts.join(" ").trim();
  }

  function labelFor(el) {
    if (!el) return "Nothing selected";
    var tag = el.tagName.toLowerCase();
    var id = el.id ? "#" + el.id : "";
    var cls = el.classList && el.classList.length ? "." + Array.prototype.slice.call(el.classList, 0, 2).join(".") : "";
    return tag + id + cls;
  }

  function canEdit(el) {
    if (!el || !el.parentNode || el === doc.documentElement) return false;
    return true;
  }

  function unsafeReason(el, action) {
    if (!el) return "";
    var tag = el.tagName.toLowerCase();
    if (action === "delete") return "Deleting content can change page structure.";
    if (tag === "iframe") return "Iframes may contain an independent or cross-origin document.";
    if (tag === "form" || tag === "button" || tag === "input" || tag === "select" || tag === "textarea") return "This may change a live interaction or submit behavior.";
    if (tag === "a" && action === "link") return "Changing a link can navigate users to a different destination.";
    if ((tag === "img" || tag === "source") && action === "image") return "Changing media can affect loading and external resources.";
    if (action === "duplicate" && (el.id || el.getAttribute("name") || el.hasAttribute("aria-labelledby") || el.hasAttribute("aria-describedby"))) return "Duplicating this element may create duplicate IDs or accessibility references.";
    if (action === "style" && (tag === "body" || tag === "html")) return "Changing page-level styles can affect fixed and sticky content.";
    return "";
  }

  function snapshot(el, includeHTML) {
    var attrs = {};
    if (!el || !el.attributes) return null;
    Array.prototype.forEach.call(el.attributes, function (a) { attrs[a.name] = a.value; });
    var snap = { element: el, path: pathFor(el), attrs: attrs, text: directText(el), innerText: el.innerText, cssText: el.style.cssText };
    if (includeHTML) snap.innerHTML = el.innerHTML;
    return snap;
  }

  function applySnapshot(snap) {
    var el = snap && snap.element && snap.element.isConnected ? snap.element : elementAt(snap && snap.path);
    if (!el) return false;
    var current = {};
    Array.prototype.forEach.call(el.attributes, function (a) { current[a.name] = a.value; });
    Object.keys(current).forEach(function (key) { if (!(key in snap.attrs)) el.removeAttribute(key); });
    Object.keys(snap.attrs).forEach(function (key) { el.setAttribute(key, snap.attrs[key]); });
    if (snap.cssText != null) el.style.cssText = snap.cssText;
    if (snap.innerHTML != null) {
      if (el.innerHTML !== snap.innerHTML) el.innerHTML = snap.innerHTML;
    } else if (snap.text !== directText(el)) {
      var textNodes = [];
      Array.prototype.forEach.call(el.childNodes, function (n) { if (n.nodeType === 3) textNodes.push(n); });
      if (textNodes.length) textNodes[0].nodeValue = snap.text;
      else if (snap.text) el.insertBefore(doc.createTextNode(snap.text), el.firstChild);
    }
    return true;
  }

  function cloneHTML(el) {
    return el && el.outerHTML;
  }

  function insertAt(parent, index, html) {
    if (!parent || !html) return null;
    var holder = doc.createElement("template");
    holder.innerHTML = html;
    var node = holder.content.firstElementChild;
    if (node) parent.insertBefore(node, parent.children[index] || null);
    return node;
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
    });
  }

  function safeComponentValue(value, spec) {
    var type = spec && spec.type || "text";
    if (value == null && spec && spec.default != null) value = spec.default;
    if (type === "number") {
      var number = Number(value);
      return isFinite(number) ? String(number) : String(spec && spec.default != null ? spec.default : "");
    }
    if (type === "select") {
      var options = spec && Array.isArray(spec.options) ? spec.options : [];
      var allowed = options.map(function (option) {
        return typeof option === "object" ? String(option.value == null ? option.label : option.value) : String(option);
      });
      var selected = allowed.indexOf(String(value)) >= 0 ? String(value) : String(spec && spec.default != null ? spec.default : (allowed[0] || ""));
      return escapeHTML(selected);
    }
    if (type === "url") {
      return escapeHTML(safeURL(value, false));
    }
    if (type === "color") {
      var color = String(value == null ? "" : value).trim();
      if (!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|var\(--[a-z0-9_-]+\)|[a-z]+)$/i.test(color)) color = "";
      return escapeHTML(color);
    }
    return escapeHTML(value);
  }

  function componentHTML(component, values) {
    var html = String(component && component.html || "")
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:href|src|srcset)\s*=\s*(["'])\s*(?:javascript|vbscript):[\s\S]*?\1/gi, "");
    var props = component && component.props || {};
    html = html.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, function (_, name) {
      return safeComponentValue(values[name], props[name]);
    });
    var holder = doc.createElement("template");
    holder.innerHTML = html;
    holder.content.querySelectorAll("script").forEach(function (script) { script.remove(); });
    holder.content.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes || []).forEach(function (attribute) {
        var name = attribute.name.toLowerCase(), value = attribute.value;
        if (/^on/.test(name) || /(?:expression|javascript:|vbscript:)/i.test(value)) {
          el.removeAttribute(attribute.name);
          return;
        }
        if (name === "href" || name === "src" || name === "srcset" || name === "xlink:href") {
          var media = /^(?:img|source|video|audio|track)$/i.test(el.tagName);
          if (!safeURL(value, media)) el.removeAttribute(attribute.name);
        }
      });
    });
    return holder.innerHTML;
  }

  function tokenEntries(library, category) {
    var source = library;
    var flat = Array.isArray(library);
    if (library && !Array.isArray(library) && typeof library === "object") source = library[category];
    if (!Array.isArray(source)) return [];
    return source.map(function (token) {
      if (typeof token === "string" || typeof token === "number") return { name: String(token), label: String(token), value: String(token) };
      if (!token || token.value == null) return null;
      return {
        name: String(token.name || token.label || token.value),
        label: String(token.label || token.name || token.value),
        value: String(token.value),
        type: token.type || token.category || category
      };
    }).filter(function (token) {
      if (!token) return false;
      if (!flat || !token.type) return true;
      if (category === "class") return /^(class|semantic|visual)$/i.test(token.type);
      return String(token.type).toLowerCase() === category.toLowerCase();
    });
  }

  function mount(options) {
    if (instance) return instance.api;
    options = options || {};
    if (typeof options.componentLibrary === "string") {
      options.componentLibrary = JSON.parse(options.componentLibrary);
    }
    if (typeof options.tokenLibrary === "string") {
      options.tokenLibrary = JSON.parse(options.tokenLibrary);
    }
    if (options.componentLibrary != null && !Array.isArray(options.componentLibrary)) {
      throw new TypeError("componentLibrary must be an array or JSON array.");
    }
    var root = doc.body || doc.documentElement;
    if (!root) return null;
    var host = doc.createElement("html-editor-overlay");
    host.setAttribute("aria-label", "HTML editor");
    host.dataset.htmlEditorOverlay = VERSION;
    host.style.cssText = "all:initial;position:fixed!important;inset:0!important;z-index:2147483000!important;pointer-events:none!important;";
    (doc.body || doc.documentElement).appendChild(host);
    var shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    installStyles(shadow);
    var ui = create("div", { className: "he-ui", "aria-label": "HTML page editor" });
    shadow.appendChild(ui);

    instance = {
      host: host, shadow: shadow, ui: ui, root: root, selected: null, hovered: null,
      mode: "edit", panelOpen: false, dirty: false, past: [], future: [],
      panelPosition: null, panelPositionExplicit: false, panelDragCleanup: null, previewPosition: null, previewDragCleanup: null,
      initialPath: null, editing: null, resizeCleanup: null, dialog: null, dialogFocus: null,
      toastTimer: null, lastSaveSuccessful: false, renderedPanelFor: null,
      renderedSelectionLabel: "", renderFrame: null, renderFrameCancel: null,
      options: options, panelClose: null, listeners: []
    };

    var toolbar = create("div", { className: "he-toolbar", role: "toolbar", "aria-label": "Editor toolbar", hidden: false });
    var selection = create("div", { className: "he-selection", role: "group", "aria-label": "Selected element resize handles", hidden: true });
    var hover = create("div", { className: "he-hover", "aria-hidden": "true", hidden: true });
    var panel = create("aside", { className: "he-panel", role: "complementary", "aria-label": "Element properties", hidden: true });
    ui.appendChild(hover); ui.appendChild(selection); ui.appendChild(toolbar); ui.appendChild(panel);
    instance.toolbar = toolbar; instance.selection = selection; instance.hover = hover; instance.panel = panel;
    instance.propertiesButton = null;

    function addButton(parent, title, label, action, cls) {
      var button = create("button", { type: "button", title: title, "aria-label": title, className: cls || "" }, label);
      button.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); action(); });
      parent.appendChild(button);
      return button;
    }

    var insertButton = addButton(toolbar, "Insert a reusable component", "Insert", function () { openLibrary(); }, "he-primary");
    addButton(toolbar, "Edit text (double-click also works)", "Edit", function () { beginTextEdit(instance.selected); });
    var propertiesButton = addButton(toolbar, "Open detailed properties", "Properties", function () {
      if (!instance.selected) { showToast("Select an element to open its properties."); return; }
      instance.panelOpen = true; render();
      var first = panel.querySelector("input,textarea,select,button"); if (first) first.focus();
    });
    instance.propertiesButton = propertiesButton;
    toolbar.appendChild(create("span", { className: "he-divider", "aria-hidden": "true" }));
    addButton(toolbar, "Duplicate selected element", "Duplicate", function () { duplicateSelected(); });
    addButton(toolbar, "Delete selected element", "Delete", function () { deleteSelected(); }, "he-danger");
    toolbar.appendChild(create("span", { className: "he-divider", "aria-hidden": "true" }));
    addButton(toolbar, "Undo last change", "Undo", function () { undo(); });
    addButton(toolbar, "Redo last change", "Redo", function () { redo(); });
    toolbar.appendChild(create("span", { className: "he-divider", "aria-hidden": "true" }));
    addButton(toolbar, "Preview page without editor controls", "Preview", function () { setMode(instance.mode === "preview" ? "edit" : "preview"); }, "he-primary");
    addButton(toolbar, "Export the current HTML", "Save", function () { save(); }, "he-primary");
    addButton(toolbar, "Reset all overlay changes", "Reset", function () {
      if (instance.dirty) askConfirm("Resetting will undo all changes made by this editor.", reset);
      else reset();
    }, "he-danger");
    var panelId = "he-properties-panel-" + (++uid);
    panel.id = panelId;
    propertiesButton.setAttribute("aria-controls", panelId);
    var status = create("span", { className: "he-status", "aria-live": "polite" });
    toolbar.appendChild(status); instance.status = status;

    function focusPropertiesOpener() {
      var opener = instance && instance.propertiesButton;
      if (opener && opener.isConnected && !opener.disabled) {
        opener.focus();
        return true;
      }
      return false;
    }

    function closePropertiesPanel() {
      if (!instance || !instance.panelOpen) return;
      instance.panelOpen = false;
      instance.panelClose = null;
      render();
      focusPropertiesOpener();
    }

    function clampPosition(position, width, height) {
      var maxX = Math.max(8, (global.innerWidth || doc.documentElement.clientWidth || 320) - width - 8);
      var maxY = Math.max(8, (global.innerHeight || doc.documentElement.clientHeight || 240) - height - 8);
      return {
        left: Math.min(maxX, Math.max(8, Number(position && position.left) || 8)),
        top: Math.min(maxY, Math.max(8, Number(position && position.top) || 8))
      };
    }

    function applyPanelPosition() {
      if (!instance || !panel || panel.hidden || !instance.panelPositionExplicit) return;
      var rect = panel.getBoundingClientRect();
      var position = instance.panelPosition || { left: rect.left, top: rect.top };
      var next = clampPosition(position, rect.width || 320, rect.height || Math.min(global.innerHeight - 28, 600));
      instance.panelPosition = next;
      panel.style.left = next.left + "px";
      panel.style.top = next.top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }

    function startPanelDrag(event) {
      if (!instance || event.button !== 0) return;
      var path = event.composedPath ? event.composedPath() : [event.target];
      if (path.some(function (node) { return node && node.nodeType === 1 && /^(button|input|select|textarea|a)$/.test(node.tagName.toLowerCase()); })) return;
      event.preventDefault();
      var rect = panel.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
      panel.style.height = rect.height + "px";
      var start = instance.panelPosition || { left: rect.left, top: rect.top };
      var move = function (e) {
        var next = clampPosition({ left: start.left + e.clientX - startX, top: start.top + e.clientY - startY }, rect.width, rect.height);
        instance.panelPosition = next; instance.panelPositionExplicit = true; panel.style.left = next.left + "px"; panel.style.top = next.top + "px";
        panel.style.right = "auto"; panel.style.bottom = "auto";
      };
      var finish = function () {
        doc.removeEventListener("pointermove", move, true);
        doc.removeEventListener("pointerup", finish, true);
        doc.removeEventListener("pointercancel", finish, true);
        if (instance.panelDragCleanup === finish) instance.panelDragCleanup = null;
      };
      if (instance.panelDragCleanup) instance.panelDragCleanup();
      instance.panelDragCleanup = finish;
      doc.addEventListener("pointermove", move, true);
      doc.addEventListener("pointerup", finish, true);
      doc.addEventListener("pointercancel", finish, true);
    }

    function movePanelByKeyboard(event) {
      if (!instance || event.target !== event.currentTarget) return;
      var step = event.shiftKey ? 24 : 8;
      var dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      var dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      if (!dx && !dy) return;
      event.preventDefault();
      var rect = panel.getBoundingClientRect();
      panel.style.height = rect.height + "px";
      instance.panelPositionExplicit = true;
      instance.panelPosition = clampPosition({ left: (instance.panelPosition || rect).left + dx, top: (instance.panelPosition || rect).top + dy }, rect.width, rect.height);
      applyPanelPosition();
    }

    function applyPreviewPosition() {
      var badge = ui.querySelector(".he-preview-badge");
      if (!badge) return;
      var rect = badge.getBoundingClientRect();
      var position = instance.previewPosition || { left: rect.left, top: rect.top };
      var next = clampPosition(position, rect.width || 130, rect.height || 38);
      instance.previewPosition = next;
      badge.style.left = next.left + "px";
      badge.style.top = next.top + "px";
      badge.style.right = "auto";
      badge.style.bottom = "auto";
    }

    function startPreviewDrag(event) {
      if (!instance || event.button !== 0) return;
      event.preventDefault();
      var badge = ui.querySelector(".he-preview-badge");
      if (!badge) return;
      var rect = badge.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
      var start = instance.previewPosition || { left: rect.left, top: rect.top };
      var move = function (e) {
        var next = clampPosition({ left: start.left + e.clientX - startX, top: start.top + e.clientY - startY }, rect.width, rect.height);
        instance.previewPosition = next; badge.style.left = next.left + "px"; badge.style.top = next.top + "px";
        badge.style.right = "auto"; badge.style.bottom = "auto";
      };
      var finish = function () {
        doc.removeEventListener("pointermove", move, true);
        doc.removeEventListener("pointerup", finish, true);
        doc.removeEventListener("pointercancel", finish, true);
        if (instance.previewDragCleanup === finish) instance.previewDragCleanup = null;
      };
      if (instance.previewDragCleanup) instance.previewDragCleanup();
      instance.previewDragCleanup = finish;
      doc.addEventListener("pointermove", move, true);
      doc.addEventListener("pointerup", finish, true);
      doc.addEventListener("pointercancel", finish, true);
    }

    function movePreviewByKeyboard(event) {
      var badge = ui.querySelector(".he-preview-badge");
      if (!badge) return;
      var step = event.shiftKey ? 24 : 8, dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      var dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      if (!dx && !dy) return;
      event.preventDefault();
      var rect = badge.getBoundingClientRect(), position = instance.previewPosition || { left: rect.left, top: rect.top };
      instance.previewPosition = clampPosition({ left: position.left + dx, top: position.top + dy }, rect.width, rect.height);
      applyPreviewPosition();
    }

    function insertComponent(component, values) {
      if (!instance || !component || !component.html) return;
      var selected = instance.selected, parent = selected && selected.parentElement, index;
      if (parent && selected !== doc.body && selected !== doc.documentElement && canEdit(selected)) {
        index = Array.prototype.indexOf.call(parent.children, selected) + 1;
      } else {
        parent = doc.querySelector("main") || doc.body || instance.root;
        index = parent && parent.children ? parent.children.length : 0;
      }
      if (!parent) return;
      var html = componentHTML(component, values || {}), node = insertAt(parent, index, html);
      if (!node) { showToast("Component HTML did not produce an element."); return; }
      var nodePath = pathFor(node), parentPath = pathFor(parent), nodeRef = node;
      instance.past.push({
        label: "Component inserted", before: null, after: null,
        applyAfter: function () {
          if (!nodeRef || !nodeRef.isConnected) nodeRef = insertAt(parent && parent.isConnected ? parent : elementAt(parentPath), index, html);
        },
        applyBefore: function () {
          if (nodeRef && nodeRef.isConnected) nodeRef.remove();
          else { var old = elementAt(nodePath); if (old) old.remove(); }
        }
      });
      instance.future = []; instance.dirty = true; instance.lastSaveSuccessful = false;
      select(node); showToast("Inserted " + (component.name || "component"));
    }

    function openLibrary() {
      if (instance.dialog) return;
      var titleId = "he-library-title-" + (++uid);
      var wrap = create("div", { className: "he-dialog-wrap", role: "presentation" });
      var dialog = create("div", { className: "he-dialog he-insert-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId });
      dialog.appendChild(create("h2", { id: titleId }, "Insert component"));
      dialog.appendChild(create("p", {}, "Choose a reusable block, configure its declared props, then insert it after the selected element."));
      var library = Array.isArray(instance.options.componentLibrary) ? instance.options.componentLibrary : [];
      if (!library.length) dialog.appendChild(create("div", { className: "he-empty" }, "No components are configured yet. Pass componentLibrary to mount() or configure({ componentLibrary }) to add reusable HTML."));
      library.forEach(function (component) {
        var entry = create("div", { className: "he-library-entry" });
        entry.appendChild(create("h3", {}, component.name || component.id || "Component"));
        if (component.description) entry.appendChild(create("p", {}, component.description));
        var values = {}, props = component.props || {};
        Object.keys(props).forEach(function (name) {
          var spec = props[name] || {}, label = spec.label || name, type = spec.type === "select" ? "select" : "text";
          var input;
          if (type === "select") {
            input = create("select", { id: "he-prop-" + (++uid) });
            (spec.options || []).forEach(function (option) {
              var optionValue = typeof option === "object" ? option.value : option;
              var optionLabel = typeof option === "object" ? (option.label || option.value) : option;
              input.appendChild(create("option", { value: optionValue }, optionLabel));
            });
            input.value = spec.default == null ? (input.options[0] ? input.options[0].value : "") : spec.default;
          } else {
            input = create("input", { id: "he-prop-" + (++uid), type: /^(number|url|color)$/.test(spec.type) ? spec.type : "text", value: spec.default == null ? "" : spec.default });
          }
          var propWrap = create("div", { className: "he-field" });
          propWrap.appendChild(create("label", { "for": input.id }, label));
          propWrap.appendChild(input); entry.appendChild(propWrap); values[name] = input;
        });
        var actions = create("div", { className: "he-library-actions" });
        var add = create("button", { type: "button", className: "he-primary" }, "Insert");
        add.addEventListener("click", function () {
          var resolved = {}; Object.keys(values).forEach(function (name) { resolved[name] = values[name].value; });
          close(); insertComponent(component, resolved);
        });
        actions.appendChild(add); entry.appendChild(actions); dialog.appendChild(entry);
      });
      var cancel = create("button", { type: "button" }, "Close");
      cancel.addEventListener("click", close); dialog.appendChild(cancel); wrap.appendChild(dialog); ui.appendChild(wrap);
      instance.dialog = wrap; instance.dialogFocus = shadow.activeElement || doc.activeElement;
      instance.dialogClose = close; cancel.focus();
      wrap.addEventListener("click", function (event) { if (event.target === wrap) close(); });
      wrap.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key !== "Tab") return;
        var focusable = Array.prototype.filter.call(dialog.querySelectorAll("button,input,select,textarea"), function (el) { return !el.disabled; });
        if (!focusable.length) return;
        var active = shadow.activeElement || doc.activeElement;
        var index = focusable.indexOf(active);
        if (event.shiftKey && index <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
        else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
      });
      function close() {
        if (wrap.parentNode) wrap.remove();
        instance.dialog = null; instance.dialogClose = null;
        var focus = instance.dialogFocus; instance.dialogFocus = null;
        if (focus && focus.isConnected && typeof focus.focus === "function") focus.focus();
      }
    }

    function showToast(message) {
      var old = ui.querySelector(".he-toast"); if (old) old.remove();
      var toast = create("div", { className: "he-toast", role: "status" }, message);
      ui.appendChild(toast);
      clearTimeout(instance.toastTimer);
      instance.toastTimer = setTimeout(function () { if (toast.parentNode) toast.remove(); }, 2600);
    }

    function askConfirm(reason, action) {
      if (instance.dialog) return;
      var titleId = "he-dialog-title-" + (++uid), descriptionId = "he-dialog-description-" + (++uid);
      var wrap = create("div", { className: "he-dialog-wrap", role: "presentation" });
      var dialog = create("div", { className: "he-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": descriptionId });
      dialog.innerHTML = '<h2 id="' + titleId + '">Confirm potentially unsafe edit</h2><p id="' + descriptionId + '"></p><label class="he-check"><input type="checkbox"> I understand this change can affect page behavior.</label><div class="he-dialog-actions"></div>';
      dialog.querySelector("p").textContent = reason + " The change is reversible with Undo until you reset or reload the page.";
      var actions = dialog.querySelector(".he-dialog-actions");
      var cancel = create("button", { type: "button" }, "Cancel");
      var confirm = create("button", { type: "button", className: "he-danger" }, "Confirm edit");
      actions.appendChild(cancel); actions.appendChild(confirm); wrap.appendChild(dialog); ui.appendChild(wrap);
      instance.dialog = wrap; instance.dialogFocus = shadow.activeElement || doc.activeElement;
      cancel.focus();
      cancel.addEventListener("click", close);
      wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
      wrap.addEventListener("keydown", function (e) {
        if (e.key !== "Tab") return;
        var focusable = Array.prototype.filter.call(dialog.querySelectorAll("button,input"), function (el) { return !el.disabled; });
        if (!focusable.length) return;
        var index = focusable.indexOf(shadow.activeElement || doc.activeElement);
        if (e.shiftKey && index <= 0) { e.preventDefault(); focusable[focusable.length - 1].focus(); }
        else if (!e.shiftKey && index === focusable.length - 1) { e.preventDefault(); focusable[0].focus(); }
      });
      confirm.addEventListener("click", function () {
        if (!dialog.querySelector("input").checked) { showToast("Please acknowledge the risk to continue."); return; }
        close(); action();
      });
      function close() {
        if (wrap.parentNode) wrap.remove();
        instance.dialog = null;
        instance.dialogClose = null;
        var focus = instance.dialogFocus; instance.dialogFocus = null;
        if (focus && focus.isConnected && typeof focus.focus === "function") focus.focus();
      }
      instance.dialogClose = close;
    }

    function record(label, before, after, applyAfter, applyBefore) {
      if (!before || !after) return;
      instance.past.push({ label: label, before: before, after: after, applyAfter: applyAfter, applyBefore: applyBefore });
      instance.future = []; instance.dirty = true; instance.lastSaveSuccessful = false; instance.renderedPanelFor = null; render();
    }

    function editSnapshot(el, label, mutate, unsafeAction) {
      if (!el || !canEdit(el)) return;
      var doIt = function () {
        var before = snapshot(el); mutate(el); var after = snapshot(el);
        record(label, before, after, function () { applySnapshot(after); }, function () { applySnapshot(before); });
        select(el); showToast(label);
      };
      var reason = unsafeReason(el, unsafeAction);
      if (reason) askConfirm(reason, doIt); else doIt();
    }

    function select(el) {
      if (!instance) return;
      if (el && !isCandidate(el)) el = null;
      instance.selected = el;
      instance.initialPath = instance.initialPath || pathFor(el);
      render();
    }

    function updateRect(box, el, padding) {
      if (!el || !box) { box.hidden = true; return; }
      var r; try { r = el.getBoundingClientRect(); } catch (_) { box.hidden = true; return; }
      if (!r || (!r.width && !r.height)) { box.hidden = true; return; }
      if (r.bottom <= 0 || r.top >= global.innerHeight || r.right <= 0 || r.left >= global.innerWidth) { box.hidden = true; return; }
      var p = padding || 0;
      box.hidden = false; box.style.left = Math.max(0, r.left - p) + "px"; box.style.top = Math.max(0, r.top - p) + "px";
      box.style.width = Math.max(1, r.width + p * 2) + "px"; box.style.height = Math.max(1, r.height + p * 2) + "px";
    }

    function renderHandles() {
      while (selection.firstChild) selection.removeChild(selection.firstChild);
      selection.appendChild(create("span", { className: "he-selection-label", textContent: labelFor(instance.selected) }));
      var labels = { nw: "Resize top left", n: "Resize top", ne: "Resize top right", e: "Resize right", se: "Resize bottom right", s: "Resize bottom", sw: "Resize bottom left", w: "Resize left" };
      ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (pos) {
        var handle = create("button", { type: "button", className: "he-handle", "data-pos": pos, "aria-label": labels[pos], title: labels[pos] + " (use arrow keys)" });
        handle.addEventListener("pointerdown", startResize);
        handle.addEventListener("keydown", resizeByKeyboard);
        selection.appendChild(handle);
      });
      instance.renderedSelectionLabel = labelFor(instance.selected);
    }

    function render() {
      if (instance.selected && !instance.selected.isConnected) { instance.selected = null; instance.panelOpen = false; instance.renderedPanelFor = null; }
      var has = !!instance.selected && instance.mode === "edit";
      panel.hidden = !instance.panelOpen || !instance.selected || instance.mode === "preview";
      toolbar.hidden = instance.mode !== "edit" || !!instance.dialog;
      selection.hidden = !has;
      selection.setAttribute("aria-label", has ? "Selected " + labelFor(instance.selected) : "No element selected");
      if (has) {
        if (instance.renderedSelectionLabel !== labelFor(instance.selected)) renderHandles();
        updateRect(selection, instance.selected, 0);
        var r = instance.selected.getBoundingClientRect();
        var toolbarHeight = toolbar.offsetHeight || 42;
        var top = r.top - toolbarHeight - 8;
        if (top < 8) top = Math.min(global.innerHeight - toolbarHeight - 8, r.bottom + 8);
        top = Math.max(8, top);
        var left = Math.min(Math.max(8, r.left), Math.max(8, global.innerWidth - toolbar.offsetWidth - 8));
        if (instance.panelOpen && !panel.hidden) {
          var panelLeft = panel.getBoundingClientRect().left;
          var panelRect = panel.getBoundingClientRect();
          if (left + toolbar.offsetWidth + 8 > panelLeft) left = Math.max(8, panelLeft - toolbar.offsetWidth - 8);
          if (left + toolbar.offsetWidth + 8 > panelLeft) top = Math.max(8, panelRect.top - toolbarHeight - 8);
        }
        toolbar.style.left = left + "px"; toolbar.style.top = top + "px";
      } else if (instance.mode === "edit" && !instance.dialog) {
        toolbar.style.left = "8px";
        toolbar.style.top = "8px";
      }
      if (!panel.hidden) applyPanelPosition();
      hover.hidden = !instance.hovered || instance.mode !== "edit" || instance.hovered === instance.selected;
      if (!hover.hidden) updateRect(hover, instance.hovered, 0);
      status.textContent = instance.dirty ? "Unsaved changes" : (instance.lastSaveSuccessful ? "Saved" : "Ready");
      propertiesButton.setAttribute("aria-expanded", instance.panelOpen ? "true" : "false");
      propertiesButton.disabled = false;
      toolbar.querySelectorAll("button").forEach(function (button) {
        if (/^Edit$|^Duplicate$|^Delete$/.test(button.textContent)) button.disabled = !instance.selected;
      });
      toolbar.querySelectorAll("button").forEach(function (button) {
        if (/Undo/.test(button.title)) button.disabled = instance.past.length === 0;
        if (/Redo/.test(button.title)) button.disabled = instance.future.length === 0;
        if (/Preview/.test(button.title)) button.textContent = instance.mode === "preview" ? "Exit preview" : "Preview";
      });
      if (!panel.hidden && instance.renderedPanelFor !== instance.selected) renderPanel();
      if (instance.mode === "preview") {
        toolbar.hidden = true; selection.hidden = true; hover.hidden = true;
        if (!ui.querySelector(".he-preview-badge")) {
          var badge = create("div", { className: "he-preview-badge", role: "group", tabindex: "0", "aria-label": "Move preview control", title: "Drag to move; use arrow keys" });
          var exit = addButton(badge, "Exit preview mode", "Exit preview", function () { setMode("edit"); });
          exit.className = "he-primary";
          badge.addEventListener("pointerdown", startPreviewDrag);
          badge.addEventListener("keydown", movePreviewByKeyboard);
          ui.appendChild(badge);
          applyPreviewPosition();
        } else applyPreviewPosition();
      } else { var preview = ui.querySelector(".he-preview-badge"); if (preview) preview.remove(); }
    }

    function field(parent, label, value, type, onChange, extra) {
      var wrap = create("div", { className: "he-field" });
      var id = "he-field-" + (++uid);
      var labelEl = create("label", { "for": id }, label);
      wrap.appendChild(labelEl);
      var input = create(type === "textarea" ? "textarea" : "input", Object.assign({ id: id, type: type || "text", value: value == null ? "" : value }, extra || {}));
      if (type === "textarea") input.value = value == null ? "" : value;
      input.addEventListener("change", function () { onChange(input.value, input); });
      input.addEventListener("keydown", function (e) { if (e.key === "Enter" && type !== "textarea") { e.preventDefault(); input.blur(); } });
      wrap.appendChild(input); parent.appendChild(wrap); return input;
    }

    function tokenField(parent, label, value, onChange, category, extra) {
      var input = field(parent, label, value, "text", onChange, extra);
      var entries = [];
      if (category === "class" && Array.isArray(instance.options.tokenLibrary)) entries = tokenEntries(instance.options.tokenLibrary, category);
      else if (category === "class") ["classes", "semantic", "visual"].forEach(function (name) {
        entries = entries.concat(tokenEntries(instance.options.tokenLibrary, name));
      });
      else entries = tokenEntries(instance.options.tokenLibrary, category);
      if (entries.length) {
        var listId = "he-token-list-" + (++uid), list = create("datalist", { id: listId });
        entries.forEach(function (token) { list.appendChild(create("option", { value: token.value, label: token.label || token.name })); });
        input.setAttribute("list", listId);
        input.parentNode.appendChild(list);
        input.parentNode.appendChild(create("div", { className: "he-token-note" }, "Suggested tokens: " + entries.map(function (token) { return token.label || token.name; }).join(", ")));
      } else {
        input.parentNode.appendChild(create("div", { className: "he-token-note" }, "No " + category + " tokens configured. Freeform values are still allowed."));
      }
      return input;
    }

    function section(parent, title) {
      var sec = create("section", { className: "he-section" }); sec.appendChild(create("h3", {}, title)); parent.appendChild(sec); return sec;
    }

    function renderPanel() {
      panel.innerHTML = "";
      var header = create("div", { className: "he-panel-header", tabindex: "0", role: "group", "aria-label": "Drag properties panel" });
      var heading = create("div");
      var headingId = "he-panel-title-" + (++uid);
      heading.appendChild(create("div", { className: "he-panel-title", id: headingId }, "Properties"));
      panel.setAttribute("aria-labelledby", headingId);
      heading.appendChild(create("div", { className: "he-panel-subtitle", title: labelFor(instance.selected) }, labelFor(instance.selected)));
      heading.appendChild(create("div", { className: "he-panel-drag-hint" }, "Drag header or use arrow keys"));
      header.appendChild(heading);
      var close = create("button", { type: "button", title: "Close properties panel", className: "he-icon-button", "aria-label": "Close properties" }, "Close");
      instance.panelClose = close;
      close.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
      close.addEventListener("pointerup", function (event) {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); closePropertiesPanel();
      });
      close.addEventListener("click", function (event) {
        event.preventDefault(); event.stopPropagation(); closePropertiesPanel();
      });
      header.addEventListener("pointerdown", startPanelDrag);
      header.addEventListener("keydown", movePanelByKeyboard);
      header.appendChild(close); panel.appendChild(header);
      var body = create("div", { className: "he-panel-body" }); panel.appendChild(body);
      var el = instance.selected, tag = el.tagName.toLowerCase();
      var textSec = section(body, "Content");
      if (!el.children.length && (directText(el) || /^(p|h[1-6]|span|a|button|label|li|td|th|figcaption|blockquote)$/.test(tag))) {
        field(textSec, "Text", directText(el), "textarea", function (v) { editSnapshot(el, "Text updated", function (node) { var text = Array.prototype.slice.call(node.childNodes).find(function (n) { return n.nodeType === 3; }); if (text) text.nodeValue = v; else node.insertBefore(doc.createTextNode(v), node.firstChild); }, "text"); });
      }
      if (tag === "a") {
        var linkSec = section(body, "Link");
        field(linkSec, "Destination", el.getAttribute("href") || "", "url", function (v) {
          var next = safeURL(v, false);
          if (v.trim() && !next) { showToast("Unsafe URL rejected."); return; }
          editSnapshot(el, "Link updated", function (node) { if (next) node.setAttribute("href", next); else node.removeAttribute("href"); }, "link");
        });
        field(linkSec, "Target", el.getAttribute("target") || "", "text", function (v) { editSnapshot(el, "Link target updated", function (node) { if (v) node.setAttribute("target", v); else node.removeAttribute("target"); }, "link"); });
      }
      if (tag === "img" || tag === "source") {
        var imageSec = section(body, "Image");
        field(imageSec, "Source", el.getAttribute("src") || el.getAttribute("srcset") || "", "url", function (v) {
          var next = safeURL(v, true);
          if (v.trim() && !next) { showToast("Unsafe image URL rejected."); return; }
          editSnapshot(el, "Image source updated", function (node) { if (next) node.setAttribute(tag === "source" ? "srcset" : "src", next); else node.removeAttribute(tag === "source" ? "srcset" : "src"); }, "image");
        });
        field(imageSec, "Alt text", el.getAttribute("alt") || "", "text", function (v) { editSnapshot(el, "Alt text updated", function (node) { node.setAttribute("alt", v); }, "image"); });
        if (tag === "img" && global.FileReader) {
          var fileWrap = create("div", { className: "he-field" });
          var fileId = "he-image-file-" + (++uid);
          fileWrap.appendChild(create("label", { "for": fileId }, "Replace from device"));
          var fileInput = create("input", { id: fileId, type: "file", accept: "image/*" });
          fileInput.addEventListener("change", function () {
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;
            var reader = new global.FileReader();
            reader.onload = function () {
              var result = String(reader.result || "");
              if (!/^data:image\//i.test(result)) { showToast("That file is not a supported image."); return; }
              editSnapshot(el, "Image replaced", function (node) { node.setAttribute("src", result); }, "image");
            };
            reader.onerror = function () { showToast("Image file could not be read."); };
            reader.readAsDataURL(file);
          });
          fileWrap.appendChild(fileInput); imageSec.appendChild(fileWrap);
        }
      }
      var attrSec = section(body, "Attributes");
      field(attrSec, "ID", el.id || "", "text", function (v) { editSnapshot(el, "ID updated", function (node) { if (v) node.id = v; else node.removeAttribute("id"); }); });
      tokenField(attrSec, "Classes", el.getAttribute("class") || "", function (v) { editSnapshot(el, "Classes updated", function (node) { if (v) node.setAttribute("class", v); else node.removeAttribute("class"); }); }, "class");
      var spacing = section(body, "Spacing");
      var styles = global.getComputedStyle(el);
      var grid = create("div", { className: "he-grid" }); spacing.appendChild(grid);
      ["marginTop", "marginRight", "marginBottom", "marginLeft"].forEach(function (prop) {
        tokenField(grid, prop.replace("margin", "Margin "), el.style[prop] || styles[prop], function (v) { editSnapshot(el, prop + " updated", function (node) { node.style[prop] = v; }, "style"); }, "spacing", { placeholder: "e.g. 12px" });
      });
      var styleSec = section(body, "Style");
      var sgrid = create("div", { className: "he-grid" }); styleSec.appendChild(sgrid);
      tokenField(sgrid, "Text color", rgbToHex(styles.color), function (v) { editSnapshot(el, "Text color updated", function (node) { node.style.color = v; }, "style"); }, "colors");
      tokenField(sgrid, "Background", rgbToHex(styles.backgroundColor), function (v) { editSnapshot(el, "Background updated", function (node) { node.style.backgroundColor = v; }, "style"); }, "colors");
      field(sgrid, "Font size", el.style.fontSize || styles.fontSize, "text", function (v) { editSnapshot(el, "Font size updated", function (node) { node.style.fontSize = v; }, "style"); });
      field(sgrid, "Display", el.style.display || styles.display, "text", function (v) { editSnapshot(el, "Display updated", function (node) { node.style.display = v; }, "style"); });
      var actions = section(body, "Element");
      var actionRow = create("div", { className: "he-actions" }); actions.appendChild(actionRow);
      var dup = create("button", { type: "button" }, "Duplicate"); dup.addEventListener("click", duplicateSelected); actionRow.appendChild(dup);
      var del = create("button", { type: "button", className: "he-danger" }, "Delete"); del.addEventListener("click", deleteSelected); actionRow.appendChild(del);
      if (tag === "iframe") body.insertBefore(create("div", { className: "he-note" }, "This iframe is selected as one element. Same-origin frame contents may be editable only from inside that document; cross-origin contents are intentionally inaccessible."), body.firstChild);
      body.appendChild(create("div", { className: "he-note" }, "All editor changes create an undo snapshot. The original page is not exported until you choose Save."));
      instance.renderedPanelFor = instance.selected;
    }

    function rgbToHex(value) {
      var m = (value || "").match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (!m) return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
      return "#" + [m[1], m[2], m[3]].map(function (n) { return ("0" + parseInt(n, 10).toString(16)).slice(-2); }).join("");
    }

    function beginTextEdit(el) {
      if (!el || !canEdit(el) || instance.editing || instance.mode === "preview") return;
      if (el.children && el.children.length && !el.isContentEditable) {
        showToast("Select a text element before editing.");
        return;
      }
      var unsafe = unsafeReason(el, "text");
      var start = function () {
        var original = el.innerHTML;
        var originalState = {
          contentEditableAttr: el.getAttribute("contenteditable"),
          contentEditable: el.contentEditable,
          spellcheckAttr: el.getAttribute("spellcheck"),
          spellcheck: el.spellcheck
        };
        var before = snapshot(el, true);
        instance.editing = { el: el, original: original, originalState: originalState };
        el.setAttribute("contenteditable", "true"); el.setAttribute("data-he-editing", "true"); el.setAttribute("spellcheck", "false");
        el.focus();
        var range = doc.createRange(); range.selectNodeContents(el); range.collapse(false);
        var sel = global.getSelection && global.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        function finish(cancel) {
          if (!instance || !instance.editing || instance.editing.el !== el) return;
          el.removeAttribute("data-he-editing"); restoreEditingState(el, originalState); el.removeEventListener("blur", onBlur);
          el.removeEventListener("keydown", onKey);
          if (cancel) el.innerHTML = original;
          else if (el.innerHTML !== original) {
            var after = snapshot(el, true);
            record("Text updated", before, after, function () { applySnapshot(after); }, function () { applySnapshot(before); });
          }
          instance.editing = null; select(el); render();
        }
        function onBlur() { setTimeout(function () { if (instance && instance.editing && instance.editing.el === el) finish(false); }, 0); }
        function onKey(e) { if (e.key === "Escape") { e.preventDefault(); finish(true); } else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(false); } }
        el.addEventListener("blur", onBlur); el.addEventListener("keydown", onKey);
        instance.editing.finish = function (commit) { finish(!commit); };
        instance.editing.cleanup = function () { finish(true); };
      };
      if (unsafe) askConfirm(unsafe, start); else start();
    }

    function restoreEditingState(el, state) {
      if (!el || !state) return;
      try { el.contentEditable = state.contentEditable; } catch (_) {}
      try { el.spellcheck = state.spellcheck; } catch (_) {}
      if (state.contentEditableAttr == null) el.removeAttribute("contenteditable");
      else el.setAttribute("contenteditable", state.contentEditableAttr);
      if (state.spellcheckAttr == null) el.removeAttribute("spellcheck");
      else el.setAttribute("spellcheck", state.spellcheckAttr);
    }

    function finishActiveEdit(commit) {
      if (instance && instance.editing && instance.editing.finish) instance.editing.finish(commit);
    }

    function undo() {
      if (!instance) return;
      finishActiveEdit(true);
      if (!instance.past.length) return;
      var action = instance.past.pop();
      if (action.applyBefore) action.applyBefore(); else applySnapshot(action.before);
      instance.future.push(action); instance.dirty = instance.past.length > 0; render(); showToast("Undid " + action.label.toLowerCase());
    }

    function redo() {
      if (!instance) return;
      finishActiveEdit(true);
      if (!instance.future.length) return;
      var action = instance.future.pop();
      if (action.applyAfter) action.applyAfter(); else applySnapshot(action.after);
      instance.past.push(action); instance.dirty = true; render(); showToast("Redid " + action.label.toLowerCase());
    }

    function duplicateSelected() {
      finishActiveEdit(true);
      var el = instance.selected, parent = el && el.parentElement;
      if (!el || !parent || !canEdit(el)) return;
      if (el === doc.body || el === doc.documentElement) { showToast("The page root cannot be duplicated."); return; }
      var run = function () {
        var index = Array.prototype.indexOf.call(parent.children, el) + 1, html = cloneHTML(el), copy = insertAt(parent, index, html);
        if (!copy) return;
        var path = pathFor(copy);
        var copyRef = copy;
        var action = {
          label: "Element duplicated", before: null, after: null,
          applyAfter: function () {
            if (copyRef && copyRef.isConnected) return;
            if (parentRef) copyRef = insertAt(parentRef, index, html);
            else if (path) copyRef = insertAt(elementAt(path.slice(0, -1)), path[path.length - 1], html);
          },
          applyBefore: function () { if (copyRef && copyRef.isConnected) copyRef.remove(); else if (path) { var node = elementAt(path); if (node) node.remove(); } }
        };
        var parentRef = parent;
        instance.past.push(action); instance.future = []; instance.dirty = true; instance.lastSaveSuccessful = false; select(copy); showToast("Element duplicated");
      };
      var reason = unsafeReason(el, "duplicate"); if (reason) askConfirm(reason, run); else run();
    }

    function deleteSelected() {
      finishActiveEdit(true);
      var el = instance.selected, parent = el && el.parentElement;
      if (!el || !parent || !canEdit(el)) return;
      if (el === doc.body || el === doc.documentElement) { showToast("The page root cannot be deleted."); return; }
      askConfirm(unsafeReason(el, "delete"), function () {
        var index = Array.prototype.indexOf.call(parent.children, el), html = cloneHTML(el), parentPath = pathFor(parent);
        var parentRef = parent;
        el.remove(); instance.selected = null;
        var action = {
          label: "Element deleted", before: null, after: null,
          applyAfter: function () {
            var node = parentRef && parentRef.isConnected ? parentRef : elementAt(parentPath);
            if (node && node.children[index]) node.children[index].remove();
            else if (node && node.children.length > index) node.children[index].remove();
          },
          applyBefore: function () {
            var node = parentRef && parentRef.isConnected ? parentRef : elementAt(parentPath);
            insertAt(node, index, html);
          }
        };
        instance.past.push(action); instance.future = []; instance.dirty = true; instance.lastSaveSuccessful = false; render(); showToast("Element deleted - Undo is available");
      });
    }

    function resizeByKeyboard(event) {
      var el = instance.selected, handle = event.currentTarget, pos = handle && handle.getAttribute("data-pos");
      if (!el || !pos || instance.mode !== "edit" || !canEdit(el)) return;
      var styles = global.getComputedStyle(el), width = parseFloat(el.style.width || styles.width), height = parseFloat(el.style.height || styles.height);
      if (!isFinite(width) || !isFinite(height)) return;
      var step = event.shiftKey ? 10 : 1, nextWidth = width, nextHeight = height;
      if (event.key === "ArrowRight" && /[ew]/.test(pos)) nextWidth += step;
      else if (event.key === "ArrowLeft" && /[ew]/.test(pos)) nextWidth = Math.max(20, nextWidth - step);
      else if (event.key === "ArrowDown" && /[ns]/.test(pos)) nextHeight += step;
      else if (event.key === "ArrowUp" && /[ns]/.test(pos)) nextHeight = Math.max(20, nextHeight - step);
      else return;
      event.preventDefault();
      var before = snapshot(el);
      el.style.width = nextWidth + "px"; el.style.height = nextHeight + "px";
      var after = snapshot(el);
      record("Size updated", before, after, function () { applySnapshot(after); }, function () { applySnapshot(before); });
      render();
    }

    function startResize(event) {
      event.preventDefault(); event.stopPropagation();
      var el = instance.selected, handle = event.currentTarget;
      if (!el || !handle || !canEdit(el)) return;
      if (instance.resizeCleanup) instance.resizeCleanup(false);
      var pos = handle.getAttribute("data-pos"), startX = event.clientX, startY = event.clientY, rect = el.getBoundingClientRect(), before = snapshot(el);
      var move = function (e) {
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (/e/.test(pos)) el.style.width = Math.max(20, rect.width + dx) + "px";
        if (/s/.test(pos)) el.style.height = Math.max(20, rect.height + dy) + "px";
        if (/w/.test(pos)) el.style.width = Math.max(20, rect.width - dx) + "px";
        if (/n/.test(pos)) el.style.height = Math.max(20, rect.height - dy) + "px";
        updateRect(selection, el, 0);
      };
      var finish = function (commit) {
        doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", cancel);
        if (instance.resizeCleanup === finish) instance.resizeCleanup = null;
        if (!commit) { applySnapshot(before); render(); return; }
        var after = snapshot(el); record("Size updated", before, after, function () { applySnapshot(after); }, function () { applySnapshot(before); }); render();
      };
      var up = function () { finish(true); };
      var cancel = function () { finish(false); };
      instance.resizeCleanup = finish;
      doc.addEventListener("pointermove", move); doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", cancel);
    }

    function setMode(mode) {
      if (!instance) return;
      if (mode === "preview") {
        finishActiveEdit(true);
        if (instance.dialogClose) instance.dialogClose();
        instance.panelOpen = false;
        var toast = ui.querySelector(".he-toast"); if (toast) toast.remove();
      }
      instance.mode = mode === "preview" ? "preview" : "edit";
      render();
    }

    function exportHTML() {
      if (!instance) return "";
      finishActiveEdit(true);
      var clone = doc.documentElement.cloneNode(true);
      var overlay = clone.querySelector("html-editor-overlay[data-html-editor-overlay]");
      if (overlay) overlay.remove();
      clone.querySelectorAll("[data-he-editing],[data-he-overlay]").forEach(function (el) {
        el.removeAttribute("data-he-editing");
        el.removeAttribute("data-he-overlay");
      });
      clone.querySelectorAll("*").forEach(function (el) {
        Array.prototype.slice.call(el.attributes || []).forEach(function (attribute) {
          if (/^data-he-/i.test(attribute.name)) el.removeAttribute(attribute.name);
        });
      });
      clone.querySelectorAll("script").forEach(function (script) {
        var src = script.getAttribute("src") || "";
        var code = script.textContent || "";
        if (/html-editor-overlay(?:\.min)?\.js(?:[?#]|$)/i.test(src) || /\bHtmlEditorOverlay\b/.test(code)) script.remove();
      });
      return "<!doctype html>\n" + clone.outerHTML;
    }

    function save() {
      if (!instance) return;
      var html = exportHTML();
      function markSaved() {
        if (!instance) return html;
        instance.dirty = false; instance.past = []; instance.future = []; instance.lastSaveSuccessful = true; render(); showToast("HTML exported");
        return html;
      }
      if (typeof options.onSave === "function") {
        var saved = options.onSave(html, getState());
        if (saved === false) {
          if (!instance) return { success: false, html: html };
          showToast("Save failed");
          return { success: false, html: html };
        }
        if (saved && typeof saved.then === "function") {
          return saved.then(function (result) {
            if (result === false) {
              if (instance) showToast("Save failed");
              return { success: false, html: html };
            }
            return markSaved();
          }, function (error) {
            if (instance) showToast("Save failed");
            throw error;
          });
        }
      } else {
        var blob = new Blob([html], { type: "text/html;charset=utf-8" }), url = global.URL.createObjectURL(blob), a = create("a", { href: url, download: options.fileName || "edited-page.html" });
        a.click(); setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
      }
      return markSaved();
    }

    function reset() {
      if (!instance) return;
      finishActiveEdit(true);
      while (instance.past.length) undo();
      instance.future = []; instance.dirty = false; instance.lastSaveSuccessful = false; instance.selected = null; instance.panelOpen = false; render(); showToast("Changes reset");
    }

    function configure(next) {
      if (!instance || !next) return instance && instance.api;
      if (Object.prototype.hasOwnProperty.call(next, "componentLibrary")) {
        var components = typeof next.componentLibrary === "string" ? JSON.parse(next.componentLibrary) : next.componentLibrary;
        if (components != null && !Array.isArray(components)) throw new TypeError("componentLibrary must be an array or JSON array.");
        instance.options.componentLibrary = Array.isArray(components) ? components : [];
      }
      if (Object.prototype.hasOwnProperty.call(next, "tokenLibrary")) {
        instance.options.tokenLibrary = typeof next.tokenLibrary === "string" ? JSON.parse(next.tokenLibrary) : next.tokenLibrary;
      }
      instance.renderedPanelFor = null;
      render();
      return instance.api;
    }

    function scheduleRender() {
      if (!instance || instance.renderFrame) return;
      var raf = global.requestAnimationFrame || function (callback) { return global.setTimeout(callback, 16); };
      var scheduledInstance = instance;
      instance.renderFrame = raf(function () {
        if (!instance || instance !== scheduledInstance) return;
        instance.renderFrame = null; instance.renderFrameCancel = null; render();
      });
      instance.renderFrameCancel = function () {
        if (global.cancelAnimationFrame && raf === global.requestAnimationFrame) global.cancelAnimationFrame(instance.renderFrame);
        else global.clearTimeout(instance.renderFrame);
      };
    }

    function selectParentOrChild(direction) {
      if (!instance.selected) return;
      var next = direction < 0 ? instance.selected.parentElement : instance.selected.firstElementChild;
      while (next && !isCandidate(next)) next = direction < 0 ? next.parentElement : next.firstElementChild;
      if (next) select(next);
    }

    function onPointerOver(event) {
      if (instance.mode !== "edit" || instance.dialog) return;
      var path = event.composedPath ? event.composedPath() : [event.target];
      if (path.some(isEditorNode)) {
        if (instance.hovered) { instance.hovered = null; scheduleRender(); }
        return;
      }
      var el = path.find(function (n) { return n && n.nodeType === 1 && isCandidate(n); });
      if (instance.hovered !== (el || null)) { instance.hovered = el || null; scheduleRender(); }
    }
    function onPointerOut(event) {
      if (event.relatedTarget && (event.relatedTarget === instance.host || (event.relatedTarget.nodeType && instance.host.contains(event.relatedTarget)))) return;
      if (instance.hovered) { instance.hovered = null; scheduleRender(); }
    }
    function onPointerUp(event) {
      if (instance.mode !== "edit" || instance.dialog || instance.editing || !instance.panelOpen || !instance.panelClose) return;
      var path = event.composedPath ? event.composedPath() : [event.target];
      if (event.button === 0 && path.indexOf(instance.panelClose) >= 0) {
        event.preventDefault(); event.stopPropagation(); closePropertiesPanel();
      }
    }
    function onClick(event) {
      if (instance.mode !== "edit" || instance.dialog) return;
      if (instance.editing) finishActiveEdit(true);
      var path = event.composedPath ? event.composedPath() : [event.target];
      if (instance.panelOpen && instance.panelClose && path.indexOf(instance.panelClose) >= 0) {
        event.preventDefault(); event.stopPropagation(); closePropertiesPanel(); return;
      }
      if (path.some(isEditorNode)) return;
      var el = path.find(function (n) { return n && n.nodeType === 1 && isCandidate(n); });
      if (el) {
        if (!isNativeEditingEvent(event)) { event.preventDefault(); event.stopPropagation(); }
        select(el);
      }
    }
    function onDblClick(event) {
      if (instance.mode !== "edit" || instance.dialog) return;
      if (instance.editing) finishActiveEdit(true);
      var path = event.composedPath ? event.composedPath() : [event.target];
      if (path.some(isEditorNode)) return;
      var el = path.find(function (n) { return n && n.nodeType === 1 && isCandidate(n); });
      if (el && directText(el) && !isNativeEditingEvent(event)) { event.preventDefault(); event.stopPropagation(); select(el); beginTextEdit(el); }
    }
    function onKeyDown(event) {
      if (instance.dialog) { if (event.key === "Escape" && instance.dialogClose) instance.dialogClose(); return; }
      if (isNativeEditingEvent(event)) return;
      var editorEvent = (event.composedPath ? event.composedPath() : [event.target]).some(isEditorNode);
      var mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if (event.key === "Escape") {
        if (instance.editing) return;
        if (instance.mode === "preview") setMode("edit");
        else if (instance.panelOpen) closePropertiesPanel();
        else { instance.selected = null; render(); }
      }
      else if (event.key === "Delete" && instance.selected && !instance.editing && instance.mode === "edit") { event.preventDefault(); deleteSelected(); }
      else if (!editorEvent && event.key === "ArrowUp" && instance.selected && !instance.editing && !event.altKey) { event.preventDefault(); selectParentOrChild(-1); }
      else if (!editorEvent && event.key === "ArrowDown" && instance.selected && !instance.editing && !event.altKey) { event.preventDefault(); selectParentOrChild(1); }
    }
    function refresh() { if (instance) scheduleRender(); }
    doc.addEventListener("pointerover", onPointerOver, true); doc.addEventListener("pointerout", onPointerOut, true); doc.addEventListener("pointerup", onPointerUp, true);
    doc.addEventListener("click", onClick, true); doc.addEventListener("dblclick", onDblClick, true); doc.addEventListener("keydown", onKeyDown, true);
    global.addEventListener("scroll", refresh, true); global.addEventListener("resize", refresh, true);
    instance.listeners = [
      [doc, "pointerover", onPointerOver, true], [doc, "pointerout", onPointerOut, true], [doc, "pointerup", onPointerUp, true],
      [doc, "click", onClick, true], [doc, "dblclick", onDblClick, true], [doc, "keydown", onKeyDown, true],
      [global, "scroll", refresh, true], [global, "resize", refresh, true]
    ];
    function onBeforeUnload(event) {
      if (!instance || (!instance.dirty && !instance.editing)) return;
      event.preventDefault(); event.returnValue = "";
    }
    global.addEventListener("beforeunload", onBeforeUnload);
    instance.listeners.push([global, "beforeunload", onBeforeUnload]);

    function getState() {
      if (!instance) return { mounted: false, version: VERSION };
      return {
        mounted: true, version: VERSION, mode: instance.mode, dirty: instance.dirty,
        selected: instance.selected ? { tag: instance.selected.tagName.toLowerCase(), path: pathFor(instance.selected), label: labelFor(instance.selected) } : null,
        canUndo: instance.past.length > 0, canRedo: instance.future.length > 0, panelOpen: instance.panelOpen,
        panelPosition: instance.panelPosition ? { left: instance.panelPosition.left, top: instance.panelPosition.top } : null
      };
    }

    function unmount() {
      if (!instance) return;
      if (instance.renderFrameCancel) instance.renderFrameCancel();
      if (instance.resizeCleanup) instance.resizeCleanup(false);
      if (instance.panelDragCleanup) instance.panelDragCleanup();
      if (instance.previewDragCleanup) instance.previewDragCleanup();
      if (instance.editing && instance.editing.cleanup) instance.editing.cleanup();
      if (instance.dialogClose) instance.dialogClose();
      instance.listeners.forEach(function (item) { item[0].removeEventListener(item[1], item[2], item[3]); });
      if (instance.host && instance.host.parentNode) instance.host.parentNode.removeChild(instance.host);
      if (global.HtmlEditorOverlay) global.HtmlEditorOverlay.__instance = null;
      instance = null;
    }

    var api = {
      version: VERSION, mount: mount, unmount: unmount, getState: getState,
      select: function (el) { if (instance) return select(el); },
      undo: function () { if (instance) return undo(); },
      redo: function () { if (instance) return redo(); },
      reset: function () { if (instance) return reset(); },
      save: function () { if (instance) return save(); },
      exportHTML: function () { if (instance) return exportHTML(); },
      configure: function (next) { return configure(next); },
      setMode: function (mode) { if (instance) return setMode(mode); }, __instance: instance
    };
    instance.api = api;
    global.HtmlEditorOverlay.__instance = instance;
    render();
    return api;
  }

  global.HtmlEditorOverlay = {
    version: VERSION,
    mount: mount,
    unmount: function () { if (instance && instance.api) return instance.api.unmount(); },
    getState: function () { return instance ? instance.api.getState() : { mounted: false, version: VERSION }; },
    select: function (el) { return instance && instance.api.select(el); },
    undo: function () { return instance && instance.api.undo(); },
    redo: function () { return instance && instance.api.redo(); },
    reset: function () { return instance && instance.api.reset(); },
    save: function () { return instance && instance.api.save(); },
    exportHTML: function () { return instance && instance.api.exportHTML(); },
    configure: function (next) { return instance && instance.api.configure(next); },
    setMode: function (mode) { return instance && instance.api.setMode(mode); },
    __instance: null
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

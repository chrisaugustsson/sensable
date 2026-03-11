/**
 * Inspector script injected into wireframe/prototype iframes.
 * Provides hover highlighting and click-to-select for element inspection.
 *
 * Communication via postMessage:
 *   Parent → iframe: { type: "inspector-enable" } / { type: "inspector-disable" }
 *   iframe → Parent: { type: "element-selected", element: {...} }
 */

const INSPECTOR_IIFE = `(function() {
  var enabled = false;
  var overlay = null;
  var label = null;

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.setAttribute("data-inspector", "overlay");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;" +
      "outline:2px solid #3b82f6;background:rgba(59,130,246,0.08);" +
      "transition:all 0.05s ease-out;display:none;";
    document.body.appendChild(overlay);

    label = document.createElement("div");
    label.setAttribute("data-inspector", "label");
    label.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;" +
      "background:#3b82f6;color:#fff;font-size:11px;font-family:monospace;" +
      "padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;";
    document.body.appendChild(label);
  }

  function isInspectorElement(el) {
    return el && el.getAttribute && el.getAttribute("data-inspector");
  }

  function isIgnored(el) {
    var tag = el.tagName && el.tagName.toLowerCase();
    return tag === "html" || tag === "body" || isInspectorElement(el);
  }

  function buildSelector(el) {
    var parts = [];
    var current = el;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 4) {
      if (isIgnored(current)) break;
      var tag = current.tagName.toLowerCase();
      var cls = current.className && typeof current.className === "string"
        ? current.className.trim().split(/\\s+/).filter(function(c) { return c; }).slice(0, 2).join(".")
        : "";
      parts.unshift(cls ? tag + "." + cls : tag);
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function getAncestors(el) {
    var ancestors = [];
    var current = el.parentElement;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 3) {
      if (isIgnored(current)) break;
      var tag = current.tagName.toLowerCase();
      var cls = current.className && typeof current.className === "string"
        ? current.className.trim().split(/\\s+/).filter(function(c) { return c; }).slice(0, 2).join(".")
        : "";
      ancestors.push(cls ? tag + "." + cls : tag);
      current = current.parentElement;
      depth++;
    }
    return ancestors;
  }

  function getLabelText(el) {
    var tag = el.tagName.toLowerCase();
    var cls = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\\s+/).filter(function(c) { return c; }).slice(0, 2).join(".")
      : "";
    return tag + cls;
  }

  function onMouseMove(e) {
    var target = e.target;
    if (!target || isIgnored(target)) {
      overlay.style.display = "none";
      label.style.display = "none";
      return;
    }
    var rect = target.getBoundingClientRect();
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.display = "block";

    label.textContent = getLabelText(target);
    var labelTop = rect.top - 22;
    if (labelTop < 0) labelTop = rect.bottom + 2;
    label.style.top = labelTop + "px";
    label.style.left = rect.left + "px";
    label.style.display = "block";
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var target = e.target;
    if (!target || isIgnored(target)) return;

    var text = (target.textContent || "").trim();
    if (text.length > 100) text = text.substring(0, 100) + "...";

    var html = target.outerHTML || "";
    if (html.length > 500) html = html.substring(0, 500) + "...";

    var classes = target.className && typeof target.className === "string"
      ? target.className.trim().split(/\\s+/).filter(function(c) { return c; })
      : [];

    var payload = {
      tag: target.tagName.toLowerCase(),
      id: target.id || "",
      classes: classes,
      textContent: text,
      outerHTML: html,
      selector: buildSelector(target),
      ancestors: getAncestors(target)
    };

    window.parent.postMessage({ type: "element-selected", element: payload }, "*");
    disable();
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    if (!overlay) createOverlay();
    document.body.style.cursor = "crosshair";
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    if (overlay) {
      overlay.style.display = "none";
      label.style.display = "none";
    }
  }

  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "inspector-enable") enable();
    if (e.data && e.data.type === "inspector-disable") disable();
  });
})();`;

/**
 * Injects the inspector script into an HTML string.
 * Inserts before </body> if found, otherwise appends.
 * The script is inert until activated via postMessage.
 */
export function injectInspectorScript(html: string): string {
  const scriptTag = `<script>${INSPECTOR_IIFE}</script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${scriptTag}</body>`);
  }
  return html + scriptTag;
}

/*!
 * SHINENOS AI chat widget.
 * Add to any website (e.g. WordPress footer):
 *   <script src="https://YOUR-VERCEL-DOMAIN/widget.js" defer></script>
 */
(function () {
  if (window.__shinenosChat) return;
  window.__shinenosChat = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var origin = new URL(script.src, location.href).origin;

  // Every declaration is !important and fully reset so host-site themes
  // (e.g. Astra/Elementor button + svg styles) can't distort the widget.
  var css = [
    "#snx-btn{all:initial;box-sizing:border-box;position:fixed;right:20px;bottom:20px;left:auto;top:auto;z-index:2147483646;",
    "width:62px;height:62px;min-width:62px;min-height:62px;max-width:62px;max-height:62px;margin:0;padding:0;border:0;border-radius:50%;cursor:pointer;",
    "background:linear-gradient(135deg,#001746,#002673 55%,#00358f);color:#fff;box-shadow:0 10px 30px rgba(0,23,70,.4);",
    "display:flex;align-items:center;justify-content:center;line-height:1;font-size:0;text-transform:none;letter-spacing:0;",
    "transition:transform .2s;outline:3px solid #ffa608;outline-offset:-3px;transform:none}",
    "#snx-btn:hover,#snx-btn:focus{background:linear-gradient(135deg,#001746,#002673 55%,#00358f);color:#fff;transform:scale(1.06)}",
    "#snx-btn svg{display:block;width:28px;height:28px;min-width:28px;max-width:28px;margin:0;padding:0;flex:0 0 28px;fill:none;stroke:#fff;overflow:visible}",
    "#snx-btn svg *{fill:none;stroke:#fff}",
    "#snx-tip{box-sizing:border-box;position:fixed;right:92px;bottom:34px;left:auto;top:auto;z-index:2147483646;margin:0;background:#fff;color:#001746;",
    "font:500 14px/1.3 Poppins,system-ui,sans-serif;text-align:left;border:0;border-left:4px solid #ffa608;",
    "padding:10px 14px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.12);width:auto;max-width:220px;cursor:pointer}",
    "#snx-frame{box-sizing:border-box;position:fixed;right:20px;bottom:94px;left:auto;top:auto;z-index:2147483647;margin:0;padding:0;",
    "width:400px;max-width:calc(100vw - 40px);min-width:0;height:640px;max-height:calc(100vh - 120px);border:0;",
    "border-radius:18px;box-shadow:0 20px 60px rgba(15,23,42,.28);background:#fff;opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:opacity .2s,transform .2s}",
    "#snx-frame.open{opacity:1;transform:none;pointer-events:auto}",
    "@media (max-width:480px){#snx-frame{right:0;bottom:0;width:100vw;max-width:100vw;height:100dvh;max-height:none;border-radius:0}#snx-frame.open+#snx-btn{display:none}}"
  ].join("")
    // Make every declaration !important (except inside the `all:initial` reset itself).
    .replace(/:([^;{}]+)(?=[;}])/g, function (m, v) {
      return /!important/.test(v) || /^(hover|focus)\b/.test(v) ? m : ":" + v + "!important";
    });
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var chatIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  var frame = document.createElement("iframe");
  frame.id = "snx-frame";
  frame.title = "SHINENOS AI Assistant";
  frame.setAttribute("aria-hidden", "true");
  var loaded = false;

  var btn = document.createElement("button");
  btn.id = "snx-btn";
  btn.setAttribute("aria-label", "Chat with SHINENOS AI assistant");
  btn.innerHTML = chatIcon;

  var tip = document.createElement("div");
  tip.id = "snx-tip";
  tip.textContent = "👋 Questions? Ask our AI assistant!";

  document.body.appendChild(frame);
  document.body.appendChild(btn);

  var open = false;
  function toggle(force) {
    open = typeof force === "boolean" ? force : !open;
    if (open && !loaded) { frame.src = origin + "/embed"; loaded = true; }
    frame.classList.toggle("open", open);
    frame.setAttribute("aria-hidden", open ? "false" : "true");
    btn.innerHTML = open ? closeIcon : chatIcon;
    if (tip.parentNode) tip.parentNode.removeChild(tip);
  }
  btn.addEventListener("click", function () { toggle(); });
  tip.addEventListener("click", function () { toggle(true); });

  window.addEventListener("message", function (e) {
    if (e.origin === origin && e.data && e.data.type === "shinenos-chat:close") toggle(false);
  });

  // Gentle prompt after a few seconds, once per session.
  try {
    if (!sessionStorage.getItem("snx-tip")) {
      setTimeout(function () {
        if (!open) document.body.appendChild(tip);
        sessionStorage.setItem("snx-tip", "1");
      }, 4000);
    }
  } catch { /* storage blocked */ }
})();

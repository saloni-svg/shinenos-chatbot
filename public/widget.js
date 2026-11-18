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

  var css = [
    "#snx-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;width:62px;height:62px;border-radius:50%;border:0;cursor:pointer;",
    "background:linear-gradient(135deg,#001746,#002673 55%,#00358f);color:#fff;box-shadow:0 10px 30px rgba(0,23,70,.4);display:flex;align-items:center;justify-content:center;transition:transform .2s;outline:3px solid #ffa608;outline-offset:-3px}",
    "#snx-btn:hover{transform:scale(1.06)}",
    "#snx-btn svg{width:28px;height:28px}",
    "#snx-tip{position:fixed;right:92px;bottom:34px;z-index:2147483646;background:#fff;color:#001746;font:500 14px/1.3 Poppins,system-ui,sans-serif;border-left:4px solid #ffa608;",
    "padding:10px 14px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-width:220px;cursor:pointer}",
    "#snx-frame{position:fixed;right:20px;bottom:94px;z-index:2147483647;width:400px;height:640px;max-height:calc(100vh - 120px);border:0;",
    "border-radius:18px;box-shadow:0 20px 60px rgba(15,23,42,.28);background:#fff;opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:opacity .2s,transform .2s}",
    "#snx-frame.open{opacity:1;transform:none;pointer-events:auto}",
    "@media (max-width:480px){#snx-frame{right:0;bottom:0;width:100vw;height:100dvh;max-height:none;border-radius:0}#snx-frame.open+#snx-btn{display:none}}"
  ].join("");
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

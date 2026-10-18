// Forwards UI errors to the app's stderr log, so crashes before React mounts
// are visible when running the app from a terminal. Loaded before the app.
(function () {
  var send = function (msg) {
    try { window.__TAURI_INTERNALS__.invoke("ui_log", { message: String(msg).slice(0, 4000) }); } catch (e) {}
  };
  window.addEventListener("error", function (e) {
    send("error: " + (e.error && e.error.stack ? e.error.stack : e.message) + " @ " + (e.filename || "") + ":" + (e.lineno || ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    send("unhandled rejection: " + (e.reason && e.reason.stack ? e.reason.stack : e.reason));
  });
  document.addEventListener("securitypolicyviolation", function (e) {
    send("CSP blocked " + e.blockedURI + " (" + e.violatedDirective + ")");
  });
  window.addEventListener("load", function () {
    setTimeout(function () {
      var root = document.getElementById("root");
      if (!root || !root.children.length) send("UI did not render (empty #root)");
    }, 2000);
  });
})();

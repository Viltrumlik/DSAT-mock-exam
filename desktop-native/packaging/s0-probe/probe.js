// S0 probe: speaks just enough of protocol v1 (island/protocol/schema.json) to
// measure the WebView2 texture pipeline: ready -> module.loaded ->
// question.shown, answer.choose on click, key for the arrow keys.
(function () {
  "use strict";
  var wv = window.chrome && window.chrome.webview;
  var hasWebkit = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ms;
  function send(msg) {
    msg.v = 1;
    if (wv) wv.postMessage(msg);
    else if (hasWebkit) window.webkit.messageHandlers.ms.postMessage(JSON.stringify(msg));
  }
  var questions = {};
  var current = null;
  var statusEl = document.getElementById("status");
  var passageEl = document.getElementById("passage");
  var questionEl = document.getElementById("question");
  var choicesEl = document.getElementById("choices");

  function textOf(html) {
    if (!html) return "";
    var doc = new DOMParser().parseFromString(String(html), "text/html");
    return (doc.body && doc.body.textContent) || "";
  }

  function show(msg) {
    var t0 = performance.now();
    var q = questions[msg.qid];
    current = msg.qid;
    statusEl.textContent = "S0 probe: question " + (msg.index + 1) + " of " + msg.total;
    passageEl.textContent = q ? textOf(q.question_text) : "";
    questionEl.textContent = q ? textOf(q.question_prompt || "") : "Question #" + msg.qid;
    while (choicesEl.firstChild) choicesEl.removeChild(choicesEl.firstChild);
    // Bundle options are {"A": {"text": ..., "image_key": ...}, ...} or null.
    var options = (q && q.options) || {};
    var keys = Object.keys(options).sort();
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var opt = options[key] || {};
      var li = document.createElement("li");
      li.dataset.key = key;
      li.textContent = key + ". " + textOf(opt.text || "");
      if (msg.answer === key) li.className = "chosen";
      choicesEl.appendChild(li);
    }
    // Report after the browser has painted the new DOM.
    requestAnimationFrame(function () {
      send({ t: "question.shown", qid: msg.qid, ms: Math.round((performance.now() - t0) * 10) / 10 });
    });
  }

  function receive(data) {
    var msg = typeof data === "string" ? JSON.parse(data) : data;
    if (!msg || msg.v !== 1) return;
    if (msg.t === "module.load") {
      var t0 = performance.now();
      questions = {};
      (msg.questions || []).forEach(function (q) { questions[q.id] = q; });
      send({ t: "module.loaded", moduleId: msg.moduleId, ms: Math.round((performance.now() - t0) * 10) / 10, failed: [] });
    } else if (msg.t === "question.show") {
      show(msg);
    }
  }

  choicesEl.addEventListener("click", function (e) {
    var li = e.target.closest("li");
    if (!li || current === null) return;
    var key = li.dataset.key;
    if (!/^[A-F]$/.test(key)) return;
    Array.prototype.forEach.call(choicesEl.children, function (c) { c.className = c === li ? "chosen" : ""; });
    send({ t: "answer.choose", qid: current, key: key });
  });
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") send({ t: "key", key: e.key });
  });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  if (wv) wv.addEventListener("message", function (e) { receive(e.data); });
  window.msIsland = { build: "s0-probe", receive: receive };
  send({ t: "ready", build: "s0-probe", protocol: 1 });
})();

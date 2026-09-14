// Builds a self-contained, clickable demo of the review page with a scenario
// switcher and a mock server. Usage: node test/preview/build-demo.js <out.html>
'use strict';
const fs = require('fs');
const path = require('path');
const { SCENARIOS, BASE_INIT } = require('./harness');

const out = process.argv[2];
if (!out) { console.error('usage: build-demo.js <out.html>'); process.exit(1); }
let html = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'ReviewPage.html'), 'utf8');

// Strip the document wrapper: the host page supplies doctype/html/head/body.
html = html.replace(/^[\s\S]*?<title>/, '<title>').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '');

const scenarios = {};
for (const k of ['email-5', 'email-2', 'button', 'seller-4', 'already']) scenarios[k] = Object.assign({}, BASE_INIT, SCENARIOS[k].init);

const demoBar = `
<style>
  .demo { background: #1D2620; color: #F6F1E6; font-family: 'Archivo', Arial, sans-serif; font-size: 13px; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .demo span { opacity: .75; }
  .demo a { color: #F6F1E6; text-decoration: none; padding: 5px 10px; border: 1px solid rgba(246,241,230,.35); border-radius: 3px; }
  .demo a[aria-current="true"] { background: #2F5240; border-color: #2F5240; }
</style>
<nav class="demo" aria-label="Demo scenarios">
  <span>Try it as a client. Arriving from:</span>
  <a href="#email-5" data-sc="email-5">5-star tap</a>
  <a href="#email-2" data-sc="email-2">2-star tap</a>
  <a href="#button" data-sc="button">Rate button</a>
  <a href="#seller-4" data-sc="seller-4">Seller, 4 stars</a>
  <a href="#already" data-sc="already">Already reviewed</a>
  <span>Mock data. Nothing is saved. Google and Zillow buttons open placeholder pages.</span>
</nav>`;

const initCode = `var __SCENARIOS = ${JSON.stringify(scenarios).replace(/</g, '\\u003c')};
var __SC = (location.hash || '#email-5').slice(1); if (!__SCENARIOS[__SC]) __SC = 'email-5';
document.querySelectorAll('.demo a').forEach(function (a) { a.setAttribute('aria-current', a.dataset.sc === __SC ? 'true' : 'false'); });
window.addEventListener('hashchange', function () { location.reload(); });
var INIT = __SCENARIOS[__SC];`;

html = html.replace('var INIT = <?!= initJson ?>;', initCode);
html = html.replace("'<?= baseUrl ?>'", "'https://example.invalid/exec'").replace("'<?= submitToken ?>'", "'demo'").replace("'<?= qaTestToken ?>'", "''");

const mock = `
(function(){
  var srv = { status: INIT.status || 'new', token: INIT.token || null };
  window.fetch = function (url, opts) {
    var b = JSON.parse(opts.body); var res = { ok: true };
    if (b.action === 'review.rate') { if (!srv.token) srv.token = 'demo_' + Math.random().toString(36).slice(2); srv.status = 'rated'; res = { ok: true, token: srv.token, status: 'rated' }; }
    else if (b.action === 'review.submit') { srv.status = 'reviewed'; res = { ok: true, status: 'reviewed', links: { google: 'https://www.google.com/maps', zillow: 'https://www.zillow.com/' } }; }
    else if (b.action === 'review.feedback') { srv.status = 'feedback'; res = { ok: true, status: 'feedback' }; }
    return new Promise(function (r) { setTimeout(function () { r({ json: function () { return Promise.resolve(res); } }); }, 250); });
  };
})();`;
html = html.replace('// ---- End server hand-off.', '// ---- End server hand-off.' + mock);
html = html.replace('<div class="band">THE STAWASZ GROUP</div>', demoBar + '\n<div class="band">THE STAWASZ GROUP</div>');
if (html.includes('<?')) throw new Error('scriptlet left in demo');
fs.writeFileSync(out, html);
console.log('wrote', out);

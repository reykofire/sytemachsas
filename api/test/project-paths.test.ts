import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const runtime = readFileSync(new URL("../../js/runtime.js", import.meta.url), "utf8");
function app(script: string) {
  return vm.runInNewContext(runtime + "\nHS_APP", { URL, document: { currentScript: { src: script } } });
}

test("project paths retain APIs, media, links and query strings under their mount", () => {
  for (const project of ["hardsystem", "systemach"]) {
    const base = `https://ziii.ddns.net/proyectos/${project}/`;
    const mounted = app(base + "js/runtime.js?v=1");
    assert.equal(mounted.apiBase, base + "api");
    assert.equal(mounted.url("/api/media/image.png"), base + "api/media/image.png");
    assert.equal(mounted.url("slide/image.png"), base + "slide/image.png");
    assert.equal(mounted.url("portal.html?view=orders"), base + "portal.html?view=orders");
    assert.equal(mounted.url(`/proyectos/${project}/api/health/ready`), base + "api/health/ready");
    assert.equal(mounted.url("https://www.paypal.com/checkout"), "https://www.paypal.com/checkout");
  }
});

test("sessions, carts and checkout redirects use separate storage keys per project", () => {
  const first = app("https://ziii.ddns.net/proyectos/hardsystem/js/runtime.js");
  const second = app("https://ziii.ddns.net/proyectos/systemach/js/runtime.js");
  for (const name of ["hs_session_v1", "hs_cart_v1", "hs_cart_pending_v1", "hs_return_to"]) {
    assert.notEqual(first.key(name), second.key(name));
  }
});

test("direct LAN access retains original root URLs and storage keys", () => {
  const direct = app("http://192.168.100.141:8081/js/runtime.js");
  assert.equal(direct.apiBase, "http://192.168.100.141:8081/api");
  assert.equal(direct.url("/api/media/image.png"), "http://192.168.100.141:8081/api/media/image.png");
  assert.equal(direct.key("hs_session_v1"), "hs_session_v1");
});

/* Resolve URLs and browser storage independently for each mounted project. */
const HS_APP = (() => {
  const base = new URL("../", document.currentScript.src);
  const key = name => base.pathname === "/" ? name : `${name}:${base.pathname}`;
  const url = value => {
    const text = String(value ?? "");
    const scoped = text.startsWith("/") && !text.startsWith("//")
      && !text.startsWith(base.pathname) && !text.startsWith("/proyectos/")
      ? text.slice(1) : text;
    return new URL(scoped, base).href;
  };
  return Object.freeze({ baseUrl: base.href, apiBase: url("api"), key, url });
})();

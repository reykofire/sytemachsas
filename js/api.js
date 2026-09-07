const HS_API = (() => {
  const TOKEN_KEY = "hs_session_v1";
  const getToken = () => sessionStorage.getItem(TOKEN_KEY);
  const setToken = token => token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY);
  const getSessionUser = () => {
    const token = getToken();
    if (!token) return null;
    try {
      let payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      payload += "=".repeat((4 - payload.length % 4) % 4);
      const bytes = Uint8Array.from(atob(payload), character => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      setToken(null);
      return null;
    }
  };

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) setToken(null);
      const error = new Error(data.error || "No fue posible completar la operación");
      error.details = data.details;
      throw error;
    }
    return data;
  }

  async function requestBlob(path, errorMessage = "No fue posible cargar el archivo") {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api${path}`, { headers });
    if (!response.ok) throw new Error(errorMessage);
    return response.blob();
  }

  return { request, requestBlob, getToken, getSessionUser, setToken };
})();
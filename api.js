const HS_API = (() => {
  const TOKEN_KEY = "hs_session_v1";
  const getToken = () => sessionStorage.getItem(TOKEN_KEY);
  const setToken = token => token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY);

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

  return { request, requestBlob, getToken, setToken };
})();
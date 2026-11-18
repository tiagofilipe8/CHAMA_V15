// Camada de acesso a API com token JWT
const API = {
  get token() { return localStorage.getItem('os_token'); },
  set token(v) { v ? localStorage.setItem('os_token', v) : localStorage.removeItem('os_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('os_user')); } catch { return null; }
  },
  set user(v) { v ? localStorage.setItem('os_user', JSON.stringify(v)) : localStorage.removeItem('os_user'); },

  async request(method, url, body, isForm = false) {
    const opts = { method, headers: {} };
    if (this.token) opts.headers.Authorization = 'Bearer ' + this.token;
    if (body !== undefined && !isForm) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body !== undefined && isForm) {
      opts.body = body;
    }
    const res = await fetch('/api' + url, opts);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !url.includes('/auth/login')) {
        this.logout();
        window.location.hash = '#/login';
      }
      const e = new Error(data.error || 'Erro na requisição');
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body, form) { return this.request('POST', url, body, form); },
  patch(url, body) { return this.request('PATCH', url, body); },
  del(url) { return this.request('DELETE', url); },
  logout() { this.token = null; this.user = null; },
};
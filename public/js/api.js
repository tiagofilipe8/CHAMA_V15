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
        if (this.inPreview) {
          // a previa expirou ou foi encerrada: volta para a conta real
          this.restoreRealSession();
          window.location.href = '/app.html#/admin/roles';
        } else {
          this.logout();
          window.location.hash = '#/login';
        }
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
  logout() {
    this.token = null; this.user = null;
    localStorage.removeItem('os_real_token'); localStorage.removeItem('os_real_user');
  },

  // ---- Visualizacao de cargos ----
  // Guarda a sessao real do admin e passa a usar o token da previa
  get inPreview() { return !!localStorage.getItem('os_real_token'); },
  startPreview(token, user) {
    if (!this.inPreview) {
      localStorage.setItem('os_real_token', this.token);
      localStorage.setItem('os_real_user', localStorage.getItem('os_user') || '');
    }
    this.token = token; this.user = user;
  },
  restoreRealSession() {
    const t = localStorage.getItem('os_real_token');
    const u = localStorage.getItem('os_real_user');
    localStorage.removeItem('os_real_token'); localStorage.removeItem('os_real_user');
    if (t) { this.token = t; if (u) localStorage.setItem('os_user', u); }
  },
  async endPreview() {
    try { await this.request('DELETE', '/permissions/preview'); } catch {}
    this.restoreRealSession();
  },
};
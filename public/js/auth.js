/**
 * CloudSpend — Authentication Module
 */

const AuthModule = {
  currentUser: null,

  init() {
    this.bindEvents();
    this.checkSession();
  },

  bindEvents() {
    const authBtn = document.getElementById('auth-action-btn');
    const modal = document.getElementById('auth-modal');
    const closeBtn = document.getElementById('auth-modal-close');
    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const form = document.getElementById('auth-form');
    const demoBtn = document.getElementById('auth-demo-btn');

    if (authBtn) {
      authBtn.addEventListener('click', () => {
        if (this.currentUser) {
          this.signOut();
        } else {
          this.openModal('login');
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    if (tabLogin) {
      tabLogin.addEventListener('click', () => this.switchMode('login'));
    }

    if (tabRegister) {
      tabRegister.addEventListener('click', () => this.switchMode('register'));
    }

    if (form) {
      form.addEventListener('submit', (e) => this.handleFormSubmit(e));
    }

    if (demoBtn) {
      demoBtn.addEventListener('click', () => this.signInDemo());
    }
  },

  async checkSession() {
    const token = API.getToken();
    if (!token) {
      this.setGuestState();
      return;
    }

    try {
      const data = await API.get('/api/auth/me');
      this.setUserState(data.user);
      App.refreshAll();
    } catch (err) {
      this.setGuestState();
    }
  },

  openModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.classList.add('active');
      this.switchMode(mode);
    }
  },

  closeModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('active');
  },

  switchMode(mode) {
    const title = document.getElementById('auth-modal-title');
    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const nameGroup = document.getElementById('auth-name-group');
    const incomeGroup = document.getElementById('auth-income-group');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (mode === 'register') {
      title.textContent = 'Create CloudSpend Account';
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      nameGroup.style.display = 'block';
      incomeGroup.style.display = 'block';
      submitBtn.textContent = 'Create Account';
      submitBtn.dataset.mode = 'register';
    } else {
      title.textContent = 'Sign In to CloudSpend';
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      nameGroup.style.display = 'none';
      incomeGroup.style.display = 'none';
      submitBtn.textContent = 'Sign In';
      submitBtn.dataset.mode = 'login';
    }
  },

  async handleFormSubmit(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('auth-submit-btn');
    const isRegister = submitBtn.dataset.mode === 'register';

    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value;
    const income = document.getElementById('auth-income').value;

    submitBtn.disabled = true;
    submitBtn.textContent = isRegister ? 'Creating Account...' : 'Signing In...';

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const payload = isRegister
        ? { email, password, name, defaultMonthlyIncome: Number(income) || 0 }
        : { email, password };

      const res = await API.post(endpoint, payload);
      API.setToken(res.token);
      this.setUserState(res.user);
      this.closeModal();
      API.toast(isRegister ? 'Account created successfully!' : 'Signed in successfully!', 'success');
      App.refreshAll();
    } catch (err) {
      API.toast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isRegister ? 'Create Account' : 'Sign In';
    }
  },

  async signInDemo() {
    try {
      const res = await API.post('/api/auth/login', {
        email: 'demo@cloudspend.local',
        password: 'Password123!'
      });
      API.setToken(res.token);
      this.setUserState(res.user);
      this.closeModal();
      API.toast('Signed in as Demo User!', 'success');
      App.refreshAll();
    } catch (err) {
      API.toast('Demo account not found. Click "Create Account" or run `npm run seed`.', 'error');
    }
  },

  signOut() {
    API.post('/api/auth/logout', {}).catch(() => {});
    API.setToken(null);
    this.setGuestState();
    API.toast('Signed out.', 'info');
    App.refreshAll();
  },

  setUserState(user) {
    this.currentUser = user;
    const nameEl = document.getElementById('user-display-name');
    const btnEl = document.getElementById('auth-action-btn');

    if (nameEl) nameEl.textContent = user.name || user.email;
    if (btnEl) btnEl.textContent = 'Sign Out';
  },

  setGuestState() {
    this.currentUser = null;
    const nameEl = document.getElementById('user-display-name');
    const btnEl = document.getElementById('auth-action-btn');

    if (nameEl) nameEl.textContent = 'Guest';
    if (btnEl) btnEl.textContent = 'Sign In';
  },

  onSessionExpired() {
    this.setGuestState();
    API.toast('Your session has expired. Please sign in again.', 'info');
    this.openModal('login');
  }
};

window.AuthModule = AuthModule;

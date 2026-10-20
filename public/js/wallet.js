/**
 * CloudSpend — Wallet Ledger & Budgets Module
 */

const WalletModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const saveIncomeBtn = document.getElementById('wallet-btn-save-income');
    const addBudgetBtn = document.getElementById('wallet-btn-add-budget');
    const budgetModal = document.getElementById('budget-modal');
    const budgetCloseBtn = document.getElementById('budget-modal-close');
    const budgetCancelBtn = document.getElementById('budget-btn-cancel');
    const budgetForm = document.getElementById('budget-form');
    const snsSubscribeBtn = document.getElementById('sns-btn-subscribe');

    if (saveIncomeBtn) {
      saveIncomeBtn.addEventListener('click', () => this.saveDefaultIncome());
    }

    if (addBudgetBtn) {
      addBudgetBtn.addEventListener('click', () => {
        if (!AuthModule.currentUser) {
          AuthModule.openModal('login');
        } else {
          this.openBudgetModal();
        }
      });
    }

    if (budgetCloseBtn) budgetCloseBtn.addEventListener('click', () => this.closeBudgetModal());
    if (budgetCancelBtn) budgetCancelBtn.addEventListener('click', () => this.closeBudgetModal());
    if (budgetForm) budgetForm.addEventListener('submit', (e) => this.handleBudgetSubmit(e));

    if (snsSubscribeBtn) {
      snsSubscribeBtn.addEventListener('click', () => this.subscribeSns());
    }
  },

  async loadWallet(year, month) {
    if (!AuthModule.currentUser) {
      this.renderGuestState();
      return;
    }

    try {
      const status = await API.get(`/api/budgets/status?year=${year}&month=${month}`);

      // Update default monthly income input
      const incomeInput = document.getElementById('wallet-default-income');
      if (incomeInput) {
        incomeInput.value = status.defaultMonthlyIncome || '';
      }

      this.renderBudgetItems(status.categories || []);
    } catch (err) {
      console.warn('[Wallet] Load error:', err);
    }
  },

  renderGuestState() {
    const container = document.getElementById('wallet-budget-items');
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Sign in to view your wallet & budgets</div>
        <p class="empty-state-desc">Configure your category spending thresholds and connect real-time overspending alerts.</p>
        <button class="btn btn-primary btn-sm" onclick="AuthModule.openModal('login')">Sign In</button>
      </div>
    `;
  },

  renderBudgetItems(categories) {
    const container = document.getElementById('wallet-budget-items');
    if (!container) return;

    if (categories.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No category budgets yet</div>
          <p class="empty-state-desc">Establish spending limits for categories such as Housing, Groceries, Dining, and Utilities.</p>
          <button class="btn btn-primary btn-sm" onclick="WalletModule.openBudgetModal()">+ Create Category Budget</button>
        </div>
      `;
      return;
    }

    container.innerHTML = categories.map(cat => {
      let progressClass = '';
      let badgeClass = 'badge-neutral';
      let statusLabel = `${cat.percent}%`;

      if (cat.isOverspent) {
        progressClass = 'danger';
        badgeClass = 'badge-expense';
        statusLabel = `OVERBUDGET by ${API.formatCurrency(Math.abs(cat.remaining))}`;
      } else if (cat.isWarning) {
        progressClass = 'warning';
        badgeClass = 'badge-warning';
        statusLabel = `WARNING: ${cat.percent}% utilized`;
      } else {
        statusLabel = `${API.formatCurrency(cat.remaining)} remaining`;
      }

      const percentClamped = Math.min(100, Math.max(0, cat.percent));

      return `
        <div class="card" style="margin-bottom: 0.875rem; padding: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <strong style="font-size: 1rem;">${cat.category}</strong>
              <div style="font-size: 0.8125rem; color: var(--text-secondary); margin-top: 2px;">
                Spent: <strong class="num">${API.formatCurrency(cat.spent)}</strong> of
                Monthly Limit: <strong class="num">${cat.limit > 0 ? API.formatCurrency(cat.limit) : 'No limit set'}</strong>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="badge ${badgeClass}">${statusLabel}</span>
              ${cat.limit > 0 ? `
                <button class="btn btn-secondary btn-sm" onclick="WalletModule.openBudgetModal('${cat.category}', ${cat.limit})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="WalletModule.deleteBudget('${cat.category}')">&times;</button>
              ` : `
                <button class="btn btn-primary btn-sm" onclick="WalletModule.openBudgetModal('${cat.category}', 0)">Set Budget</button>
              `}
            </div>
          </div>
          <div class="progress-container">
            <div class="progress-bar ${progressClass}" style="width: ${percentClamped}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  openBudgetModal(category = '', limit = '') {
    const modal = document.getElementById('budget-modal');
    document.getElementById('budget-category').value = category;
    document.getElementById('budget-limit').value = limit || '';
    modal.classList.add('active');
  },

  closeBudgetModal() {
    const modal = document.getElementById('budget-modal');
    modal.classList.remove('active');
  },

  async handleBudgetSubmit(e) {
    e.preventDefault();
    const category = document.getElementById('budget-category').value.trim();
    const limit = parseFloat(document.getElementById('budget-limit').value);

    try {
      await API.post('/api/budgets', {
        category,
        monthlyLimit: limit
      });
      API.toast(`Budget for "${category}" saved.`, 'success');
      this.closeBudgetModal();
      App.refreshAll();
    } catch (err) {
      API.toast('Failed to save budget: ' + err.message, 'error');
    }
  },

  async deleteBudget(category) {
    if (!confirm(`Delete budget limit for "${category}"?`)) return;

    try {
      await API.delete(`/api/budgets/${encodeURIComponent(category)}`);
      API.toast(`Budget for "${category}" removed.`, 'info');
      App.refreshAll();
    } catch (err) {
      API.toast('Failed to delete budget: ' + err.message, 'error');
    }
  },

  async saveDefaultIncome() {
    const incomeInput = document.getElementById('wallet-default-income');
    const val = parseFloat(incomeInput.value);

    if (isNaN(val) || val < 0) {
      API.toast('Please enter a valid positive rupee amount.', 'error');
      return;
    }

    try {
      await API.put('/api/budgets/default-income', { amount: val });
      API.toast('Default monthly income updated.', 'success');
      App.refreshAll();
    } catch (err) {
      API.toast('Failed to update income: ' + err.message, 'error');
    }
  },

  async subscribeSns() {
    const emailInput = document.getElementById('sns-subscribe-email');
    const email = emailInput.value.trim();

    if (!email) {
      API.toast('Please enter a valid email address.', 'error');
      return;
    }

    try {
      const res = await API.post('/api/notifications/subscribe-sns', { email });
      API.toast(res.message || 'Subscription request sent.', 'success');
      emailInput.value = '';
    } catch (err) {
      API.toast('Subscription failed: ' + err.message, 'error');
    }
  }
};

window.WalletModule = WalletModule;

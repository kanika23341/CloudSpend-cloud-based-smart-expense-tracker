/**
 * CloudSpend — Dashboard Module
 */

const DashboardModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const addExpenseBtn = document.getElementById('dash-btn-add-expense');
    const addIncomeBtn = document.getElementById('dash-btn-add-income');
    const setBudgetBtn = document.getElementById('dash-btn-set-budget');
    const exportBtn = document.getElementById('dash-btn-export');

    if (addExpenseBtn) {
      addExpenseBtn.addEventListener('click', () => {
        if (!AuthModule.currentUser) {
          AuthModule.openModal('login');
        } else {
          TransactionsModule.openCreateModal('expense');
        }
      });
    }

    if (addIncomeBtn) {
      addIncomeBtn.addEventListener('click', () => {
        if (!AuthModule.currentUser) {
          AuthModule.openModal('login');
        } else {
          TransactionsModule.openCreateModal('income');
        }
      });
    }

    if (setBudgetBtn) {
      setBudgetBtn.addEventListener('click', () => App.switchTab('wallet'));
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => App.switchTab('cloud'));
    }
  },

  async loadData(year, month) {
    if (!AuthModule.currentUser) {
      this.renderGuestState();
      return;
    }

    try {
      const [summary, budgetStatus, recentTx] = await Promise.all([
        API.get(`/api/analytics/summary?year=${year}&month=${month}`),
        API.get(`/api/budgets/status?year=${year}&month=${month}`),
        API.get('/api/transactions?page=1&limit=5')
      ]);

      this.renderSummary(summary);
      this.renderBudgetStatus(budgetStatus);
      this.renderRecentTransactions(recentTx.data || []);
    } catch (err) {
      console.warn('[Dashboard] Load error:', err);
    }
  },

  renderGuestState() {
    document.getElementById('dash-spend').textContent = '₹0.00';
    document.getElementById('dash-income').textContent = '₹0.00';
    document.getElementById('dash-balance').textContent = '₹0.00';
    document.getElementById('dash-budget-rem').textContent = '₹0.00';
    document.getElementById('dash-spend-sub').textContent = 'Sign in to track spending';
    document.getElementById('dash-income-sub').textContent = 'Net savings: ₹0.00';
    document.getElementById('dash-savings-rate').textContent = 'Savings rate: 0.0%';

    const budgetList = document.getElementById('dash-budget-list');
    budgetList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Sign in to view budgets</div>
        <p class="empty-state-desc">Create an account or sign in to configure your monthly category budgets.</p>
        <button class="btn btn-primary btn-sm" onclick="AuthModule.openModal('login')">Sign In</button>
      </div>
    `;

    const recentList = document.getElementById('dash-recent-list');
    recentList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Sign in to view activity</div>
        <p class="empty-state-desc">Your personal financial ledger will appear here.</p>
        <button class="btn btn-secondary btn-sm" onclick="AuthModule.openModal('login')">Sign In</button>
      </div>
    `;
  },

  renderSummary(summary) {
    document.getElementById('dash-spend').textContent = API.formatCurrency(summary.totalExpense);
    document.getElementById('dash-spend-sub').textContent = `${summary.transactionCount} transactions in ${summary.monthFormatted}`;

    document.getElementById('dash-income').textContent = API.formatCurrency(summary.totalIncome);
    document.getElementById('dash-income-sub').textContent = `Net savings: ${API.formatCurrency(summary.netSavings)}`;

    document.getElementById('dash-balance').textContent = API.formatCurrency(summary.availableBalance);
    document.getElementById('dash-budget-rem').textContent = API.formatCurrency(summary.budgetRemaining);
    document.getElementById('dash-savings-rate').textContent = `Savings rate: ${summary.savingsRate}%`;

    const budgetSub = document.getElementById('dash-budget-sub');
    if (budgetSub) {
      if (summary.availableBalance <= 0) {
        budgetSub.textContent = '₹0 cash remaining (overdrawn balance)';
        budgetSub.style.color = 'var(--danger)';
      } else if (summary.budgetCappedByCash) {
        budgetSub.textContent = `Capped by available cash (limit headroom: ${API.formatCurrency(summary.plannedBudgetHeadroom)})`;
        budgetSub.style.color = 'var(--warning)';
      } else if (summary.totalBudget > 0) {
        budgetSub.textContent = `${API.formatCurrency(summary.budgetRemaining)} of ${API.formatCurrency(summary.totalBudget)} limit remaining`;
        budgetSub.style.color = 'var(--text-muted)';
      } else {
        budgetSub.textContent = 'Unspent cash available this month';
        budgetSub.style.color = 'var(--text-muted)';
      }
    }
  },

  renderBudgetStatus(budgetStatus) {
    const listEl = document.getElementById('dash-budget-list');
    const badgeEl = document.getElementById('dash-budget-summary-badge');
    const categories = budgetStatus.categories || [];

    badgeEl.textContent = `${categories.length} categories`;

    if (categories.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No category budgets configured</div>
          <p class="empty-state-desc">Set limits for categories like Groceries, Rent, and Dining to track spending.</p>
          <button class="btn btn-secondary btn-sm" onclick="App.switchTab('wallet')">Configure Budgets</button>
        </div>
      `;
      return;
    }

    listEl.innerHTML = categories.map(cat => {
      let progressClass = '';
      let badgeClass = 'badge-neutral';
      let statusText = `${cat.percent}%`;

      if (cat.isOverspent) {
        progressClass = 'danger';
        badgeClass = 'badge-expense';
        statusText = 'Overspent';
      } else if (cat.isWarning) {
        progressClass = 'warning';
        badgeClass = 'badge-warning';
        statusText = 'Warning 80%+';
      }

      const percentClamped = Math.min(100, Math.max(0, cat.percent));

      return `
        <div style="margin-bottom: 0.875rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-size: 0.875rem; font-weight: 500;">${cat.category}</span>
            <div>
              <span class="badge ${badgeClass}">${statusText}</span>
              <span class="num" style="font-size: 0.8125rem; margin-left: 4px; color: var(--text-secondary);">
                ${API.formatCurrency(cat.spent)} / ${cat.limit > 0 ? API.formatCurrency(cat.limit) : 'No limit'}
              </span>
            </div>
          </div>
          <div class="progress-container">
            <div class="progress-bar ${progressClass}" style="width: ${percentClamped}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderRecentTransactions(transactions) {
    const listEl = document.getElementById('dash-recent-list');

    if (!transactions || transactions.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No transactions recorded yet</div>
          <p class="empty-state-desc">Add your first expense or income entry to see your ledger.</p>
          <button class="btn btn-primary btn-sm" onclick="TransactionsModule.openCreateModal()">Record Transaction</button>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${transactions.map(t => `
              <tr>
                <td>${API.formatDate(t.date)}</td>
                <td style="font-weight: 500;">${t.description}</td>
                <td><span class="badge badge-neutral">${t.category}</span></td>
                <td style="text-align: right;" class="num ${t.type === 'income' ? 'income' : 'expense'}">
                  ${t.type === 'income' ? '+' : '-'}${API.formatCurrency(t.amount)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
};

window.DashboardModule = DashboardModule;

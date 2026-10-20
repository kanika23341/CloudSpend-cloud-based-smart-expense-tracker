/**
 * CloudSpend — Main Application Controller & Orchestrator
 */

const App = {
  activeTab: 'dashboard',
  selectedYear: new Date().getFullYear(),
  selectedMonth: new Date().getMonth() + 1,

  init() {
    this.setupMonthPicker();
    this.setupTabs();
    this.setupNotifications();

    // Initialize submodules
    AuthModule.init();
    DashboardModule.init();
    TransactionsModule.init();
    AnalyticsModule.init();
    CalendarModule.init();
    WalletModule.init();
    CloudModule.init();

    // Initial data load
    this.refreshAll();

    // Poll notifications every 30s
    setInterval(() => this.loadNotifications(), 30000);
  },

  setupMonthPicker() {
    const picker = document.getElementById('global-month-picker');
    if (!picker) return;

    const now = new Date();
    const curMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    picker.value = curMonthStr;

    picker.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      const [y, m] = val.split('-');
      this.selectedYear = parseInt(y, 10);
      this.selectedMonth = parseInt(m, 10);
      this.refreshAll();
    });
  },

  setupTabs() {
    const tabs = document.querySelectorAll('.nav-tab[data-tab]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  },

  switchTab(tabName) {
    this.activeTab = tabName;

    // Update nav tab active class
    document.querySelectorAll('.nav-tab[data-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab panel visibility
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });

    // Lazy load tab contents
    if (tabName === 'transactions') {
      TransactionsModule.loadTransactions();
    } else if (tabName === 'analytics') {
      AnalyticsModule.loadAnalytics(this.selectedYear, this.selectedMonth);
    } else if (tabName === 'calendar') {
      CalendarModule.loadCalendar(this.selectedYear, this.selectedMonth);
    } else if (tabName === 'wallet') {
      WalletModule.loadWallet(this.selectedYear, this.selectedMonth);
    } else if (tabName === 'cloud') {
      CloudModule.loadStatus();
    } else if (tabName === 'dashboard') {
      DashboardModule.loadData(this.selectedYear, this.selectedMonth);
    }
  },

  setupNotifications() {
    const btn = document.getElementById('notif-toggle-btn');
    const dropdown = document.getElementById('notif-dropdown');
    const readAllBtn = document.getElementById('notif-read-all-btn');

    if (btn && dropdown) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
        if (dropdown.classList.contains('active')) {
          this.loadNotifications();
        }
      });

      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
          dropdown.classList.remove('active');
        }
      });
    }

    if (readAllBtn) {
      readAllBtn.addEventListener('click', async () => {
        try {
          await API.post('/api/notifications/read-all', {});
          this.loadNotifications();
        } catch (err) {
          console.warn('[Notifications] Error marking read:', err);
        }
      });
    }
  },

  async loadNotifications() {
    if (!AuthModule.currentUser) {
      document.getElementById('notif-badge').style.display = 'none';
      return;
    }

    try {
      const res = await API.get('/api/notifications?limit=20');
      const notifs = res.notifications || [];
      const unreadCount = notifs.filter(n => !n.read).length;

      const badge = document.getElementById('notif-badge');
      if (unreadCount > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = unreadCount;
      } else {
        badge.style.display = 'none';
      }

      const listEl = document.getElementById('notif-list');
      if (notifs.length === 0) {
        listEl.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.8125rem;">No notifications.</div>`;
        return;
      }

      listEl.innerHTML = notifs.map(n => `
        <div class="notif-item ${!n.read ? 'unread' : ''}">
          <div class="notif-title">${n.title}</div>
          <div style="color: var(--text-secondary);">${n.message}</div>
          <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">
            ${new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.warn('[Notifications] Failed to load:', err);
    }
  },

  refreshAll() {
    DashboardModule.loadData(this.selectedYear, this.selectedMonth);
    TransactionsModule.loadTransactions();
    AnalyticsModule.loadAnalytics(this.selectedYear, this.selectedMonth);
    CalendarModule.loadCalendar(this.selectedYear, this.selectedMonth);
    WalletModule.loadWallet(this.selectedYear, this.selectedMonth);
    CloudModule.loadStatus();
    this.loadNotifications();
  }
};

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

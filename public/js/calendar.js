/**
 * CloudSpend — Interactive Monthly Calendar & Heatmap Module
 */

const CalendarModule = {
  currentYear: 2026,
  currentMonth: 10,
  dailyData: {},
  selectedDates: new Set(),

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const clearBtn = document.getElementById('cal-btn-clear-selection');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearSelection();
      });
    }
  },

  async loadCalendar(year, month) {
    this.currentYear = parseInt(year, 10);
    this.currentMonth = parseInt(month, 10);

    const titleEl = document.getElementById('cal-month-title');
    const d = new Date(this.currentYear, this.currentMonth - 1, 1);
    titleEl.textContent = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    if (!AuthModule.currentUser) {
      this.dailyData = {};
      this.renderGrid();
      return;
    }

    try {
      const res = await API.get(`/api/analytics/daily?year=${year}&month=${month}`);
      this.dailyData = {};
      (res.daily || []).forEach(item => {
        this.dailyData[item.date] = {
          expense: Number(item.expense) || 0,
          income: Number(item.income) || 0,
          count: item.count || 0
        };
      });

      this.renderGrid();
      if (this.selectedDates.size > 0) {
        this.fetchSelectedDatesTransactions();
      }
    } catch (err) {
      console.warn('[Calendar] Load error:', err);
    }
  },

  renderGrid() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    grid.innerHTML = '';

    // Day headers (Sun - Sat)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(name => {
      const h = document.createElement('div');
      h.className = 'cal-header-cell';
      h.textContent = name;
      grid.appendChild(h);
    });

    const year = this.currentYear;
    const month = this.currentMonth - 1; // 0-indexed for JS Date

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    // Compute max expense for heat density mapping
    const expenseValues = Object.values(this.dailyData).map(d => d.expense).filter(v => v > 0);
    const maxExpense = expenseValues.length > 0 ? Math.max(...expenseValues) : 100;

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const prevDateNum = daysInPrevMonth - i;
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell other-month';
      cell.innerHTML = `<span class="cal-day-number">${prevDateNum}</span>`;
      grid.appendChild(cell);
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = this.dailyData[dateStr] || { expense: 0, income: 0, count: 0 };

      // Determine heat density level (0 to 4)
      let heatLevel = 0;
      if (dayData.expense > 0) {
        const ratio = dayData.expense / maxExpense;
        if (ratio > 0.75) heatLevel = 4;
        else if (ratio > 0.50) heatLevel = 3;
        else if (ratio > 0.25) heatLevel = 2;
        else heatLevel = 1;
      }

      const isToday = dateStr === todayStr;
      const isSelected = this.selectedDates.has(dateStr);

      const cell = document.createElement('div');
      cell.className = `cal-day-cell heat-${heatLevel} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`;
      cell.dataset.date = dateStr;

      let metricsHtml = '';
      if (dayData.expense > 0) {
        metricsHtml += `<span class="cal-spend-tag expense">-${API.formatCurrency(dayData.expense)}</span>`;
      }
      if (dayData.income > 0) {
        metricsHtml += `<span class="cal-spend-tag income">+${API.formatCurrency(dayData.income)}</span>`;
      }

      cell.innerHTML = `
        <span class="cal-day-number">${d}</span>
        <div class="cal-day-metrics">${metricsHtml}</div>
      `;

      cell.addEventListener('click', () => this.toggleDateSelection(dateStr));
      grid.appendChild(cell);
    }

    // Next month filler days to complete standard 35 or 42 grid cells
    const totalRendered = firstDayIndex + daysInMonth;
    const trailingDays = (7 - (totalRendered % 7)) % 7;
    for (let n = 1; n <= trailingDays; n++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell other-month';
      cell.innerHTML = `<span class="cal-day-number">${n}</span>`;
      grid.appendChild(cell);
    }
  },

  toggleDateSelection(dateStr) {
    if (this.selectedDates.has(dateStr)) {
      this.selectedDates.delete(dateStr);
    } else {
      this.selectedDates.add(dateStr);
    }

    this.renderGrid();
    this.updateSelectionSummary();
  },

  clearSelection() {
    this.selectedDates.clear();
    this.renderGrid();
    this.updateSelectionSummary();
  },

  async updateSelectionSummary() {
    const banner = document.getElementById('cal-selection-banner');
    const txCard = document.getElementById('cal-selected-tx-card');

    if (this.selectedDates.size === 0) {
      banner.style.display = 'none';
      txCard.style.display = 'none';
      return;
    }

    banner.style.display = 'flex';
    document.getElementById('cal-sel-count').textContent = `${this.selectedDates.size} date${this.selectedDates.size > 1 ? 's' : ''} selected`;

    await this.fetchSelectedDatesTransactions();
  },

  async fetchSelectedDatesTransactions() {
    const datesArray = Array.from(this.selectedDates);
    if (datesArray.length === 0) return;

    try {
      const res = await API.post('/api/transactions/by-dates', { dates: datesArray });

      document.getElementById('cal-sel-expense').textContent = API.formatCurrency(res.totalExpense);
      document.getElementById('cal-sel-income').textContent = API.formatCurrency(res.totalIncome);
      document.getElementById('cal-sel-net').textContent = API.formatCurrency(res.net);

      this.renderSelectedTransactions(res.transactions || []);
    } catch (err) {
      console.warn('[Calendar:SelectedTx] Error:', err);
    }
  },

  renderSelectedTransactions(transactions) {
    const card = document.getElementById('cal-selected-tx-card');
    const tbody = document.getElementById('cal-selected-tx-body');

    card.style.display = 'block';

    if (transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No transactions recorded on selected date(s).</td></tr>`;
      return;
    }

    tbody.innerHTML = transactions.map(t => `
      <tr>
        <td>${API.formatDate(t.date)}</td>
        <td><span class="badge ${t.type === 'expense' ? 'badge-expense' : 'badge-income'}">${t.type}</span></td>
        <td><span class="badge badge-neutral">${t.category}</span></td>
        <td><strong>${t.description}</strong></td>
        <td><span style="font-size: 0.8125rem;">${t.payment_method}</span></td>
        <td style="text-align: right;" class="num ${t.type === 'expense' ? 'expense' : 'income'}">
          <strong>${t.type === 'expense' ? '-' : '+'}${API.formatCurrency(t.amount)}</strong>
        </td>
      </tr>
    `).join('');
  }
};

window.CalendarModule = CalendarModule;

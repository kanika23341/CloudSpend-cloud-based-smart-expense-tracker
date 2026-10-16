document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);


  const state = {
    user: null,
    expenses: [],
    incomes: [],
    monthlyIncomeDefault: 0,
    transfersTotal: 0,
    savings: { status: "loading", data: null, message: "" },
    savingsRequest: 0,
    savingsMonth: localDate().slice(0, 7),
    savingsRange: "6",
    savingsChart: null,
    goals: { status: "loading", data: null, message: "" },
    goalsRequest: 0,
    breakdown: { status: "loading", data: null, message: "" },
    breakdownRequest: 0,
    breakdownMonth: localDate().slice(0, 7),
    breakdownReduce: 20,
    breakdownChart: null,
    incomeCalendarMonth: localDate().slice(0, 7),
    selectedIncomeDate: localDate(),
    period: "monthly",
    selectedPeriodKey: null,
    detailMonth: null,
    selectedDates: new Set(),
    periodChart: null,
    categoryChart: null,
    detailCategoryChart: null,
    pleasures: [],
    pleasureEdit: false,
    pleasureDate: localDate(),
    pleasureDateAuto: true,
    editingPleasureId: null,
    poppedPleasure: null
  };

  const categoryColors = [
    "#55745d", "#91a88e", "#c4b99b", "#a7b6bd",
    "#d1a58a", "#879b83", "#c9cfc6", "#b8a3b5", "#8b8980"
  ];

  const categoryLabels = [
    "Food", "Bills", "Transport", "Education",
    "Health", "Entertainment", "Shopping", "Subscriptions", "Other"
  ];

  const PAYMENT_METHODS = ["UPI", "Card", "Cash", "Bank transfer", "Other"];

  const EMOJI_SUGGESTIONS = [
    "🍵", "☕", "🥟", "🍪", "🍦", "🥤", "🧃", "🍩",
    "🍿", "🍫", "🍕", "🍔", "🥪", "🚌", "🛺", "🎬"
  ];

  // Starter set. Everything here can be edited or removed in the app.
  const DEFAULT_PLEASURES = [
    { name: "Tea", emoji: "🍵", amount: 15, category: "Food", payment: "Cash" },
    { name: "Coffee", emoji: "☕", amount: 30, category: "Food", payment: "Cash" },
    { name: "Samosa", emoji: "🥟", amount: 20, category: "Food", payment: "Cash" },
    { name: "Biscuits", emoji: "🍪", amount: 10, category: "Food", payment: "Cash" },
    { name: "Fresh juice", emoji: "🥤", amount: 40, category: "Food", payment: "UPI" },
    { name: "Ice cream", emoji: "🍦", amount: 30, category: "Food", payment: "UPI" }
  ];

  // Helpers

  function localDate(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function money(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function compactMoney(value) {
    const n = Number(value) || 0;
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
    return `₹${Math.round(n)}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function formatMonth(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric"
    });
  }

  function total(items) {
    const sum = items.reduce((running, item) => running + Number(item.amount || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  function createId() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Server API

  class ApiError extends Error {
    constructor(message, status = 0, field = null) {
      super(message);
      this.status = status;
      this.field = field;
    }
  }

  async function api(method, url, body) {
    let response;

    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-Requested-With": "cloudspend" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError("Could not reach the server. Check your connection and try again.");
    }

    if (response.status === 401) {
      window.location.assign("/login");
      throw new ApiError("Your session has ended. Please log in again.", 401);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ApiError(data.error || "Something went wrong. Please try again.", response.status, data.field);
    }

    return data;
  }

  function incomeTotal(items = state.incomes) {
    return total(items);
  }

  function incomesForMonth(monthKey) {
    return state.incomes.filter(
      (item) => item.date.slice(0, 7) === monthKey
    );
  }

  function incomesForDate(dateKey) {
    return state.incomes
      .filter((item) => item.date === dateKey)
      .sort((a, b) =>
        String(a.createdAt || "").localeCompare(
          String(b.createdAt || "")
        )
      );
  }

  // Wallet

  function renderWallet() {
    const nowMonth = localDate().slice(0, 7);
    const monthIncome = incomeTotal(incomesForMonth(nowMonth));

    const monthExpenses = total(
      state.expenses.filter(
        (item) => item.date.slice(0, 7) === nowMonth
      )
    );

    const balance = Math.round((incomeTotal() - total(state.expenses) - state.transfersTotal) * 100) / 100;

    const values = {
      walletBalance: money(balance),
      walletMonthIncome: money(monthIncome),
      walletMonthExpenses: money(monthExpenses),
      walletMonthRemaining: money(monthIncome - monthExpenses)
    };

    Object.entries(values).forEach(([id, value]) => {
      if ($(id)) $(id).textContent = value;
    });

    if (
      $("monthlyIncomeAmount") &&
      document.activeElement !== $("monthlyIncomeAmount")
    ) {
      $("monthlyIncomeAmount").value =
        state.monthlyIncomeDefault || "";
    }

    const activity = $("incomeActivityList");

    if (activity) {
      activity.replaceChildren();

      const recent = [...state.incomes]
        .sort((a, b) =>
          b.date.localeCompare(a.date) ||
          String(b.createdAt || "").localeCompare(
            String(a.createdAt || "")
          )
        )
        .slice(0, 6);

      if (!recent.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent =
          "No income recorded yet. Choose Add income to record your first entry.";
        activity.appendChild(empty);
      } else {
        recent.forEach((item) => {
          const row = document.createElement("div");
          row.className = "income-activity-row";

          const left = document.createElement("div");

          const name = document.createElement("p");
          name.className = "income-activity-name";
          name.textContent = item.description;

          const date = document.createElement("span");
          date.className = "income-activity-date";
          date.textContent = formatDate(item.date);

          left.append(name, date);

          const amount = document.createElement("strong");
          amount.className = "income-activity-amount";
          amount.textContent = `+${money(item.amount)}`;

          row.append(left, amount);
          activity.appendChild(row);
        });
      }
    }
  }

  // Income calendar navigation

  function showIncomeCalendar() {
    if ($("overviewPage")) $("overviewPage").hidden = true;

    if ($("monthDetail")) {
      $("monthDetail").hidden = true;
      $("monthDetail").classList.add("hidden");
    }

    if ($("incomeCalendarPage")) {
      $("incomeCalendarPage").hidden = false;
      $("incomeCalendarPage").classList.remove("hidden");
    }

    state.incomeCalendarMonth =
      (state.selectedIncomeDate || localDate()).slice(0, 7);

    renderIncomeCalendar();
    renderIncomeDateEntries();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showOverviewPage() {
    if ($("overviewPage")) $("overviewPage").hidden = false;

    if ($("monthDetail")) {
      $("monthDetail").hidden = true;
      $("monthDetail").classList.add("hidden");
    }

    if ($("incomeCalendarPage")) {
      $("incomeCalendarPage").hidden = true;
      $("incomeCalendarPage").classList.add("hidden");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderIncomeCalendar() {
    const grid = $("incomeCalendarGrid");
    if (!grid) return;

    const [year, month] = state.incomeCalendarMonth
      .split("-")
      .map(Number);

    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const mondayOffset = (first.getDay() + 6) % 7;

    $("incomeCalendarTitle").textContent =
      first.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric"
      });

    grid.replaceChildren();

    for (let i = 0; i < mondayOffset; i++) {
      const blank = document.createElement("span");
      blank.className = "calendar-blank";
      blank.setAttribute("aria-hidden", "true");
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey =
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const entries = incomesForDate(dateKey);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day heat-0";

      if (entries.length) button.classList.add("has-income");

      if (dateKey === state.selectedIncomeDate) {
        button.classList.add("income-date-selected");
      }

      button.dataset.incomeDate = dateKey;

      button.setAttribute(
        "aria-pressed",
        String(dateKey === state.selectedIncomeDate)
      );

      button.setAttribute(
        "aria-label",
        `${formatDate(dateKey)}${
          entries.length
            ? `, income ${money(incomeTotal(entries))}`
            : ", no income recorded"
        }`
      );

      const number = document.createElement("span");
      number.className = "calendar-day-number";
      number.textContent = String(day);
      button.appendChild(number);

      if (entries.length) {
        const amount = document.createElement("span");
        amount.className = "calendar-day-total";
        amount.textContent = compactMoney(incomeTotal(entries));
        button.appendChild(amount);
      }

      grid.appendChild(button);
    }

    updateIncomeSelectedDateLabels();
  }

  function updateIncomeSelectedDateLabels() {
    const label = state.selectedIncomeDate
      ? formatDate(state.selectedIncomeDate)
      : "Choose a day";

    if ($("incomeSelectedDateLabel")) {
      $("incomeSelectedDateLabel").textContent = label;
    }

    if ($("incomeFormDateHeading")) {
      $("incomeFormDateHeading").textContent =
        state.selectedIncomeDate
          ? `Income on ${label}`
          : "Select a date first";
    }
  }

  function renderIncomeDateEntries() {
    const container = $("incomeSelectedDateEntries");
    if (!container) return;

    container.replaceChildren();

    const entries = state.selectedIncomeDate
      ? incomesForDate(state.selectedIncomeDate)
      : [];

    if (!entries.length) {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = "No income recorded on this date yet.";
      container.appendChild(note);
      return;
    }

    entries.forEach((item) => {
      const row = document.createElement("div");
      row.className = "income-selected-entry";

      const name = document.createElement("span");
      name.textContent = item.description;

      const amount = document.createElement("strong");
      amount.textContent = money(item.amount);

      row.append(name, amount);
      container.appendChild(row);
    });
  }

  function selectIncomeDate(dateKey) {
    state.selectedIncomeDate = dateKey;

    const calendarMonth = dateKey.slice(0, 7);

    if (calendarMonth !== state.incomeCalendarMonth) {
      state.incomeCalendarMonth = calendarMonth;
    }

    renderIncomeCalendar();
    renderIncomeDateEntries();

    if (
      $("incomeAmount") &&
      state.monthlyIncomeDefault > 0 &&
      !$("incomeAmount").value
    ) {
      $("incomeAmount").value =
        String(state.monthlyIncomeDefault);
    }

    if ($("incomeDescription") && !$("incomeDescription").value) {
      $("incomeDescription").value = "";
    }
  }

  // Expense calculations

  function categoryOf(expense) {
    return categoryLabels.includes(expense.category)
      ? expense.category
      : "Other";
  }

  function expensesForMonth(monthKey) {
    return state.expenses.filter(
      (expense) => expense.date.startsWith(monthKey)
    );
  }

  function expensesForDate(dateKey) {
    return state.expenses.filter(
      (expense) => expense.date === dateKey
    );
  }

  function monthTotal(monthKey) {
    return total(expensesForMonth(monthKey));
  }

  function dateTotal(dateKey) {
    return total(expensesForDate(dateKey));
  }

  // Time-period grouping

  function periodKeyForDate(dateString, period = state.period) {
    const date = new Date(`${dateString}T00:00:00`);
    const year = date.getFullYear();
    const month = date.getMonth();

    if (period === "monthly") {
      return `${year}-${String(month + 1).padStart(2, "0")}`;
    }

    if (period === "bimonthly") {
      return `${year}-B${Math.floor(month / 2) + 1}`;
    }

    if (period === "quarterly") {
      return `${year}-Q${Math.floor(month / 3) + 1}`;
    }

    if (period === "halfyearly") {
      return `${year}-H${month < 6 ? 1 : 2}`;
    }

    return String(year);
  }

  function periodLabel(key, period = state.period) {
    if (period === "monthly") return formatMonth(key);

    if (period === "bimonthly") {
      const [year, blockText] = key.split("-B");
      const block = Number(blockText);
      const startMonth = (block - 1) * 2;

      const start = new Date(Number(year), startMonth, 1);
      const end = new Date(Number(year), startMonth + 1, 1);

      return `${start.toLocaleDateString("en-IN", {
        month: "short"
      })}–${end.toLocaleDateString("en-IN", {
        month: "short"
      })} ${year}`;
    }

    if (period === "quarterly") {
      return `${key.split("-")[1]} ${key.split("-")[0]}`;
    }

    if (period === "halfyearly") {
      return `${key.split("-")[1]} ${key.split("-")[0]}`;
    }

    return key;
  }

  function buildPeriodData() {
    const groups = new Map();

    state.expenses.forEach((expense) => {
      const key = periodKeyForDate(expense.date);

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: periodLabel(key),
          total: 0
        });
      }

      groups.get(key).total += Number(expense.amount);
    });

    return [...groups.values()].sort(
      (a, b) => a.key.localeCompare(b.key)
    );
  }

  function expensesForPeriod(key) {
    if (!key) return [];

    return state.expenses.filter(
      (expense) => periodKeyForDate(expense.date) === key
    );
  }

  function chooseDefaultPeriodKey() {
    const data = buildPeriodData();
    return data.length ? data[data.length - 1].key : null;
  }

  // Summary metrics

  function renderSummary() {
    const totalSpent = $("totalSpent");
    const transactionCount = $("transactionCount");
    const averageExpense = $("averageExpense");

    if (totalSpent) {
      totalSpent.textContent = money(total(state.expenses));
    }

    if (transactionCount) {
      transactionCount.textContent = String(state.expenses.length);
    }

    if (averageExpense) {
      const average = state.expenses.length
        ? total(state.expenses) / state.expenses.length
        : 0;

      averageExpense.textContent = money(average);
    }
  }

  function renderTransactions() {
    const body = $("expenses-table-body");
    const emptyState = $("emptyState");

    if (!body) return;

    body.replaceChildren();

    const sorted = [...state.expenses].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.id.localeCompare(a.id)
    );

    if (emptyState) emptyState.hidden = sorted.length > 0;
    if (sorted.length === 0) return;

    sorted.forEach((expense) => {
      const row = document.createElement("tr");

      const values = [
        expense.description,
        money(expense.amount),
        categoryOf(expense),
        formatDate(expense.date),
        expense.payment || "Other"
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;

        if (index === 1) cell.className = "amount-cell";

        row.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className = "delete-expense-button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteExpense = expense.id;
      deleteButton.setAttribute(
        "aria-label",
        `Delete ${expense.description}`
      );

      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  // Category charts

  function categoryTotals(items) {
    const values = Object.fromEntries(
      categoryLabels.map((label) => [label, 0])
    );

    items.forEach((expense) => {
      values[categoryOf(expense)] += Number(expense.amount);
    });

    return categoryLabels
      .map((label) => ({
        label,
        value: values[label]
      }))
      .filter((item) => item.value > 0);
  }

  function createCategoryChart(
    canvas,
    items,
    title,
    subtitle,
    oldChart,
    emptyMessage = "No spending to show"
  ) {
    if (!canvas || typeof Chart === "undefined") {
      if (oldChart) oldChart.destroy();
      return null;
    }

    if (oldChart) oldChart.destroy();

    const breakdown = categoryTotals(items);

    if ($("categoryChartTitle") && canvas.id === "categoryChart") {
      $("categoryChartTitle").textContent = title;
    }

    if (
      $("categoryChartSubtitle") &&
      canvas.id === "categoryChart"
    ) {
      $("categoryChartSubtitle").textContent = subtitle;
    }

    const emptyPlugin = {
      id: "emptyMessage",
      afterDraw(chart) {
        if (breakdown.length || !chart.chartArea) return;

        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#858b85";
        ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(
          emptyMessage,
          (chartArea.left + chartArea.right) / 2,
          (chartArea.top + chartArea.bottom) / 2
        );
        ctx.restore();
      }
    };

    return new Chart(canvas, {
      type: "doughnut",
      plugins: [emptyPlugin],
      data: {
        labels: breakdown.map((item) => item.label),
        datasets: [{
          data: breakdown.map((item) => item.value),
          backgroundColor: breakdown.map((item) =>
            categoryColors[categoryLabels.indexOf(item.label)]
          ),
          borderColor: "#ffffff",
          borderWidth: 2,
          hoverOffset: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "63%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              padding: 14,
              boxWidth: 8,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.label}: ${money(context.raw)}`;
              }
            }
          }
        }
      }
    });
  }

  function renderCategoryChart() {
    const selectedKey =
      state.selectedPeriodKey || chooseDefaultPeriodKey();

    const items = expensesForPeriod(selectedKey);

    const title = selectedKey
      ? `Categories · ${periodLabel(selectedKey)}`
      : "Category breakdown";

    const subtitle = selectedKey
      ? "Spending within the selected period."
      : "Add expenses to see your category breakdown.";

    state.categoryChart = createCategoryChart(
      $("categoryChart"),
      items,
      title,
      subtitle,
      state.categoryChart
    );
  }

  // The doughnut on the month screen follows the calendar: with dates
  // selected it shows just those days, otherwise the whole month.
  function renderDetailCategoryChart() {
    if (!state.detailMonth) return;

    const dayCount = state.selectedDates.size;
    const hasSelection = dayCount > 0;

    const items = hasSelection
      ? state.expenses.filter((expense) => state.selectedDates.has(expense.date))
      : expensesForMonth(state.detailMonth);

    if ($("detailChartTitle")) {
      $("detailChartTitle").textContent =
        hasSelection ? "Selected dates" : "Category breakdown";
    }

    if ($("detailChartSubtitle")) {
      $("detailChartSubtitle").textContent = hasSelection
        ? `${dayCount} day${dayCount === 1 ? "" : "s"} selected · ${money(total(items))}. Clear to see the whole month.`
        : "For the selected month.";
    }

    state.detailCategoryChart = createCategoryChart(
      $("detailCategoryChart"),
      items,
      "Monthly categories",
      "Category totals for this month.",
      state.detailCategoryChart,
      hasSelection
        ? "No spending on the selected dates"
        : "No spending recorded this month"
    );
  }

  // Spending bar chart

  function renderPeriodChart() {
    const canvas = $("periodChart");

    if (!canvas || typeof Chart === "undefined") return;

    if (state.periodChart) state.periodChart.destroy();

    const data = buildPeriodData();

    if (!data.some((item) => item.key === state.selectedPeriodKey)) {
      state.selectedPeriodKey = data.length
        ? data[data.length - 1].key
        : null;
    }

    state.periodChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.map((item) => item.label),
        datasets: [{
          label: "Expenditure",
          data: data.map((item) => item.total),
          backgroundColor: data.map((item) =>
            item.key === state.selectedPeriodKey
              ? "#405c48"
              : "#8ca48d"
          ),
          hoverBackgroundColor: "#405c48",
          borderRadius: 4,
          maxBarThickness: 48
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick(_event, activeElements) {
          if (!activeElements.length) return;

          const index = activeElements[0].index;
          const chosen = data[index];

          if (!chosen) return;

          state.selectedPeriodKey = chosen.key;

          if (state.period === "monthly") {
            openMonthDetail(chosen.key);
          } else {
            renderPeriodChart();
            renderCategoryChart();
          }
        },
        onHover(event, activeElements) {
          if (event.native?.target) {
            event.native.target.style.cursor =
              activeElements.length ? "pointer" : "default";
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => compactMoney(value)
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return `Expenditure: ${money(context.raw)}`;
              }
            }
          }
        }
      }
    });

    const hint = $("periodChartHint");

    if (hint) {
      hint.textContent = state.period === "monthly"
        ? "Select a monthly bar to open its daily calendar."
        : "Select a bar to update the category breakdown for that period.";
    }
  }

  $("periodSelect")?.addEventListener("change", (event) => {
    state.period = event.target.value;
    state.selectedPeriodKey = chooseDefaultPeriodKey();

    renderPeriodChart();
    renderCategoryChart();
  });

  // Monthly detail page

  function openMonthDetail(monthKey) {
    state.detailMonth = monthKey;
    state.selectedDates.clear();

    $("overviewPage").hidden = true;
    $("monthDetail").hidden = false;
    $("monthDetail").classList.remove("hidden");

    renderMonthDetail();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeMonthDetail() {
    $("monthDetail").hidden = true;
    $("monthDetail").classList.add("hidden");
    $("overviewPage").hidden = false;

    renderPeriodChart();
    renderCategoryChart();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("backToAnalysis")?.addEventListener("click", closeMonthDetail);

  function renderMonthDetail() {
    if (!state.detailMonth) return;

    $("detailMonthLabel").textContent = formatMonth(state.detailMonth);
    $("calendarTitle").textContent = formatMonth(state.detailMonth);
    $("detailMonthTotal").textContent = money(monthTotal(state.detailMonth));

    renderCalendar();
    renderSelectedDates();
    renderSelectedDateTransactions();
    renderDetailCategoryChart();
  }

  // Spending calendar heatmap

  function heatLevel(amount, maximum) {
    if (amount <= 0 || maximum <= 0) return 0;

    const ratio = amount / maximum;

    if (ratio <= 0.25) return 1;
    if (ratio <= 0.50) return 2;
    if (ratio <= 0.75) return 3;

    return 4;
  }

  function renderCalendar() {
    const grid = $("calendarGrid");

    if (!grid || !state.detailMonth) return;

    grid.replaceChildren();

    const [year, month] = state.detailMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const dailyTotals = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const key =
        `${state.detailMonth}-${String(day).padStart(2, "0")}`;

      dailyTotals.push(dateTotal(key));
    }

    const maxDailySpend = Math.max(0, ...dailyTotals);
    const mondayOffset = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < mondayOffset; i++) {
      const blank = document.createElement("div");
      blank.className = "calendar-day calendar-day-empty";
      blank.setAttribute("aria-hidden", "true");
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const key =
        `${state.detailMonth}-${String(day).padStart(2, "0")}`;

      const spent = dailyTotals[day - 1];
      const level = heatLevel(spent, maxDailySpend);

      const button = document.createElement("button");
      button.type = "button";
      button.className = `calendar-day heat-${level}`;
      button.dataset.date = key;

      button.setAttribute(
        "aria-pressed",
        String(state.selectedDates.has(key))
      );

      if (state.selectedDates.has(key)) {
        button.classList.add("selected");
      }

      const number = document.createElement("span");
      number.className = "calendar-day-number";
      number.textContent = String(day);
      button.appendChild(number);

      if (spent > 0) {
        const amount = document.createElement("span");
        amount.className = "calendar-day-total";
        amount.textContent = compactMoney(spent);
        button.appendChild(amount);

        const count = expensesForDate(key).length;

        button.title =
          `${formatDate(key)} · ${money(spent)} · ${count} transaction${count === 1 ? "" : "s"}`;

        button.setAttribute(
          "aria-label",
          `${formatDate(key)}, spent ${money(spent)}`
        );
      } else {
        button.title = `${formatDate(key)} · No recorded spending`;

        button.setAttribute(
          "aria-label",
          `${formatDate(key)}, no recorded spending`
        );
      }

      grid.appendChild(button);
    }
  }

  $("calendarGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;

    const dateKey = button.dataset.date;

    if (state.selectedDates.has(dateKey)) {
      state.selectedDates.delete(dateKey);
    } else {
      state.selectedDates.add(dateKey);
    }

    renderCalendar();
    renderSelectedDates();
    renderSelectedDateTransactions();
    renderDetailCategoryChart();
  });

  // Multi-day totals

  function renderSelectedDates() {
    const dates = [...state.selectedDates].sort();

    const combined = dates.reduce(
      (sum, date) => sum + dateTotal(date),
      0
    );

    $("selectedDatesTotal").textContent = money(combined);

    const list = $("selectedDatesList");
    list.replaceChildren();

    if (!dates.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "Select dates on the calendar.";
      list.appendChild(message);
      return;
    }

    dates.forEach((dateKey) => {
      const row = document.createElement("div");
      row.className = "selected-date-item";

      const date = document.createElement("span");
      date.textContent = formatDate(dateKey);

      const amount = document.createElement("strong");
      amount.textContent = money(dateTotal(dateKey));

      row.append(date, amount);
      list.appendChild(row);
    });
  }

  $("clearSelectedDates")?.addEventListener("click", () => {
    state.selectedDates.clear();

    renderCalendar();
    renderSelectedDates();
    renderSelectedDateTransactions();
    renderDetailCategoryChart();
  });

  function renderSelectedDateTransactions() {
    const container = $("selectedDateTransactions");
    container.replaceChildren();

    const dates = [...state.selectedDates].sort();

    if (!dates.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No dates selected.";
      container.appendChild(message);
      return;
    }

    const selectedSet = new Set(dates);

    const matching = state.expenses
      .filter((expense) => selectedSet.has(expense.date))
      .sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.description.localeCompare(b.description)
      );

    if (!matching.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent =
        "There are no recorded expenses on these dates.";
      container.appendChild(message);
      return;
    }

    const table = document.createElement("table");
    table.className = "detail-transactions-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    ["Date", "Description", "Category", "Payment", "Amount"]
      .forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });

    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");

    matching.forEach((expense) => {
      const row = document.createElement("tr");

      const values = [
        formatDate(expense.date),
        expense.description,
        categoryOf(expense),
        expense.payment || "Other",
        money(expense.amount)
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;

        if (index === 4) cell.className = "amount-cell";

        row.appendChild(cell);
      });

      tbody.appendChild(row);
    });

    table.append(thead, tbody);
    container.appendChild(table);
  }

  // Calendar month navigation

  function changeMonth(offset) {
    if (!state.detailMonth) return;

    const [year, month] = state.detailMonth.split("-").map(Number);
    const next = new Date(year, month - 1 + offset, 1);

    state.detailMonth =
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;

    state.selectedDates.clear();

    renderMonthDetail();
  }

  $("previousMonth")?.addEventListener("click", () => changeMonth(-1));
  $("nextMonth")?.addEventListener("click", () => changeMonth(1));

  // Add expenses

  $("date").value = $("date").value || localDate();

  $("expense-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const description = $("description").value.trim();
    const amount = Number($("amount").value);
    const date = $("date").value;
    const category = $("category").value;
    const payment = $("payment").value;

    if (!description) {
      alert("Please enter a description.");
      $("description").focus();
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Please enter an amount greater than zero.");
      $("amount").focus();
      return;
    }

    if (!date) {
      alert("Please select a date.");
      $("date").focus();
      return;
    }

    const submitButton = event.target.querySelector('[type="submit"]');
    submitButton.disabled = true;

    try {
      const { expense } = await api("POST", "/api/expenses", {
        description, amount, date, category, payment
      });

      state.expenses.push(expense);

      event.target.reset();
      $("date").value = localDate();

      refreshAll();
      showToast(`Expense of ${money(amount)} saved`);
    } catch (error) {
      alert(error.message);
    } finally {
      submitButton.disabled = false;
    }
  });

  // Delete expenses

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-expense]");
    if (!button) return;

    const id = button.dataset.deleteExpense;

    if (!window.confirm("Delete this expense?")) return;

    try {
      await api("DELETE", `/api/expenses/${id}`);

      state.expenses = state.expenses.filter(
        (expense) => expense.id !== id
      );

      refreshAll();
    } catch (error) {
      alert(error.message);
    }
  });

  // Save monthly income default

  $("monthlyIncomeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = Number($("monthlyIncomeAmount").value);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a monthly income amount greater than zero.");
      $("monthlyIncomeAmount").focus();
      return;
    }

    try {
      await api("PUT", "/api/settings", { monthlyIncomeDefault: amount });
      state.monthlyIncomeDefault = amount;

      if ($("incomeAmount")) {
        $("incomeAmount").value = String(amount);
      }

      refreshAll();

      alert(
        "Monthly income amount saved. Choose Add income to record it on the calendar and add it to your wallet."
      );
    } catch (error) {
      alert(error.message);
    }
  });

  // Open income calendar

  [
    $("walletAddIncome"),
    $("topAddIncome"),
    $("openIncomeCalendar")
  ].forEach((element) => {
    element?.addEventListener("click", (event) => {
      event.preventDefault();
      showIncomeCalendar();
    });
  });

  $("backFromIncomeCalendar")?.addEventListener(
    "click",
    showOverviewPage
  );

  $("incomeCalendarGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-income-date]");
    if (button) selectIncomeDate(button.dataset.incomeDate);
  });

  $("incomePreviousMonth")?.addEventListener("click", () => {
    const [year, month] = state.incomeCalendarMonth
      .split("-")
      .map(Number);

    state.incomeCalendarMonth =
      localDate(new Date(year, month - 2, 1)).slice(0, 7);

    renderIncomeCalendar();
  });

  $("incomeNextMonth")?.addEventListener("click", () => {
    const [year, month] = state.incomeCalendarMonth
      .split("-")
      .map(Number);

    state.incomeCalendarMonth =
      localDate(new Date(year, month, 1)).slice(0, 7);

    renderIncomeCalendar();
  });

  // Add income to wallet

  $("incomeEntryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const description = $("incomeDescription").value.trim();
    const amount = Number($("incomeAmount").value);
    const date = state.selectedIncomeDate;

    if (!date) {
      alert("Choose the date you received this income.");
      return;
    }

    if (!description) {
      alert("Enter where the money came from.");
      $("incomeDescription").focus();
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter an amount greater than zero.");
      $("incomeAmount").focus();
      return;
    }

    try {
      const { income } = await api("POST", "/api/incomes", { description, amount, date });
      state.incomes.push(income);
    } catch (error) {
      alert(error.message);
      return;
    }

    event.target.reset();

    if (state.monthlyIncomeDefault > 0) {
      $("incomeAmount").value =
        String(state.monthlyIncomeDefault);
    }

    renderIncomeCalendar();
    renderIncomeDateEntries();
    refreshAll();

    alert(`Income of ${money(amount)} added to your wallet.`);
  });

  // Savings
  //
  // Monthly savings are calculated by the server as income minus expenses.
  // Transfers into the savings wallet never change that figure, so money is
  // never counted twice. Money allocated to a goal leaves the wallet balance.

  const STATUS_LABELS = {
    met: "Goal met",
    missed: "Goal missed",
    in_progress: "In progress",
    upcoming: "Upcoming",
    no_target: "No goal set"
  };

  const STATUS_CLASSES = {
    met: "met",
    missed: "missed",
    in_progress: "progress",
    upcoming: "upcoming",
    no_target: "none"
  };

  function shiftMonth(monthKey, offset) {
    const [year, month] = monthKey.split("-").map(Number);
    return localDate(new Date(year, month - 1 + offset, 1)).slice(0, 7);
  }

  function shortMonthLabel(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit"
    });
  }

  function emptyMonth(monthKey) {
    return {
      month: monthKey, income: 0, expenses: 0, saved: 0,
      target: null, progressPercent: null, remaining: null, status: "no_target"
    };
  }

  function selectedSavingsMonth() {
    const data = state.savings.data;
    return data
      ? data.months.find((item) => item.month === state.savingsMonth) || emptyMonth(state.savingsMonth)
      : null;
  }

  async function loadSavings() {
    const token = ++state.savingsRequest;

    if (!state.savings.data) {
      state.savings = { status: "loading", data: null, message: "" };
    }

    try {
      const data = await api("GET", `/api/savings?today=${localDate()}`);
      if (token !== state.savingsRequest) return;

      state.savings = { status: "ready", data, message: "" };
      state.transfersTotal = data.wallet.transferred; // all money moved out of the spending balance
    } catch (error) {
      if (token !== state.savingsRequest) return;

      state.savings = {
        status: "error",
        data: state.savings.data,
        message: error.message
      };
    }

    renderSavings();
    renderWallet();
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function renderSavings() {
    if (!$("savings")) return;

    const { status, data } = state.savings;
    const ready = Boolean(data);
    const month = selectedSavingsMonth();
    const currentMonth = localDate().slice(0, 7);

    // Banner for load failures. Existing numbers stay visible underneath.
    $("savingsError").hidden = status !== "error";
    setText("savingsErrorText", state.savings.message || "Savings could not be loaded.");

    setText("savingsMonthLabel", formatMonth(state.savingsMonth));
    $("savingsThisMonth").hidden = state.savingsMonth === currentMonth;

    const dash = "—";
    const hasTarget = ready && month.target !== null;

    // Status badge
    const badge = $("savingsStatus");
    const key = ready ? month.status : "no_target";
    badge.textContent = ready ? STATUS_LABELS[key] : "Loading";
    badge.className = `status-badge status-${ready ? STATUS_CLASSES[key] : "none"}`;

    // Progress
    const percent = hasTarget ? month.progressPercent : 0;
    $("savingsProgressFill").style.width = `${Math.min(100, percent)}%`;
    $("savingsProgressFill").className = `savings-progress-fill fill-${ready ? STATUS_CLASSES[key] : "none"}`;
    $("savingsProgressTrack").setAttribute("aria-valuenow", String(Math.min(100, Math.round(percent))));

    setText(
      "savingsProgressText",
      !ready
        ? "Loading your savings."
        : !hasTarget
          ? "Set a goal below to track your progress for this month."
          : month.status === "met"
            ? `Goal reached. You have saved ${month.progressPercent}% of your target.`
            : `${month.progressPercent}% of your goal saved so far.`
    );

    // Figures
    setText("savingsTarget", hasTarget ? money(month.target) : ready ? "Not set" : dash);
    setText("savingsActual", ready ? money(month.saved) : dash);
    setText("savingsPercent", hasTarget ? `${month.progressPercent}%` : dash);
    setText("savingsRemaining", hasTarget ? money(month.remaining) : dash);
    $("savingsActual").classList.toggle("negative", ready && month.saved < 0);

    setText(
      "savingsBreakdown",
      ready
        ? `Income ${money(month.income)} minus expenses ${money(month.expenses)}`
        : ""
    );

    let note = "";
    if (ready) {
      if (month.income === 0 && month.expenses === 0) {
        note = "No income or expenses are recorded for this month yet, so there is nothing to calculate.";
      } else if (month.saved < 0) {
        note = "You spent more than you earned this month, so there is nothing saved yet.";
      }
    }
    setText("savingsNote", note);
    $("savingsNote").hidden = !note;

    // Goal form
    const targetInput = $("savingsTargetAmount");
    if (targetInput && document.activeElement !== targetInput) {
      targetInput.value = hasTarget ? String(month.target) : "";
    }

    setText("savingsGoalSubmit", hasTarget ? "Update goal" : "Set goal");
    $("savingsRemoveTarget").hidden = !hasTarget;
    $("savingsGoalSubmit").disabled = !ready;

    // Wallet
    const wallet = data?.wallet;
    const available = wallet ? Math.max(0, wallet.availableToTransfer) : 0;

    setText("savingsWalletBalance", wallet ? money(wallet.balance) : dash);
    setText(
      "savingsWalletGoals",
      wallet
        ? wallet.allocatedToGoals > 0
          ? `${money(wallet.allocatedToGoals)} of your ${money(wallet.transferred)} savings is allocated to goals`
          : "Money you allocate to goals leaves this balance"
        : ""
    );
    setText("savingsAvailable", wallet ? money(available) : dash);

    const dateInput = $("savingsTransferDate");
    dateInput.max = localDate();
    if (!dateInput.value) dateInput.value = localDate();

    const canTransfer = ready && available > 0;
    $("savingsTransferAmount").disabled = !canTransfer;
    $("savingsTransferNote").disabled = !canTransfer;
    dateInput.disabled = !canTransfer;
    $("savingsTransferSubmit").disabled = !canTransfer;

    setText(
      "savingsTransferHelp",
      !ready
        ? ""
        : canTransfer
          ? "Transfers move money you have already saved. They do not change your monthly savings."
          : "Nothing is available to transfer yet. Savings build up when your income is higher than your expenses."
    );

    renderSavingsHistory();
    renderSavingsTransfers();
    renderSavingsChart();
  }

  function renderSavingsHistory() {
    const container = $("savingsHistory");
    container.replaceChildren();

    const data = state.savings.data;

    if (!data) {
      const loading = document.createElement("p");
      loading.className = "muted";
      loading.textContent = state.savings.status === "error" ? "History is unavailable right now." : "Loading history.";
      container.appendChild(loading);
      return;
    }

    const hasActivity = data.months.some(
      (item) => item.income || item.expenses || item.target !== null
    );

    if (!hasActivity) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No history yet. Add income and expenses, then set a goal to see your progress month by month.";
      container.appendChild(empty);
      return;
    }

    const table = document.createElement("table");
    table.className = "savings-history-table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Month", "Goal", "Saved", "Progress", "Status"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);

    const body = document.createElement("tbody");

    [...data.months].reverse().forEach((item) => {
      const row = document.createElement("tr");
      if (item.month === state.savingsMonth) row.className = "selected-row";

      const monthCell = document.createElement("td");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "text-button";
      open.dataset.selectMonth = item.month;
      open.textContent = formatMonth(item.month);
      monthCell.appendChild(open);

      const goalCell = document.createElement("td");
      goalCell.textContent = item.target !== null ? money(item.target) : dash();

      const savedCell = document.createElement("td");
      savedCell.textContent = money(item.saved);
      if (item.saved < 0) savedCell.className = "negative";

      const progressCell = document.createElement("td");
      progressCell.textContent = item.progressPercent !== null ? `${item.progressPercent}%` : dash();

      const statusCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `status-badge status-${STATUS_CLASSES[item.status]}`;
      pill.textContent = STATUS_LABELS[item.status];
      statusCell.appendChild(pill);

      row.append(monthCell, goalCell, savedCell, progressCell, statusCell);
      body.appendChild(row);
    });

    table.append(head, body);
    container.appendChild(table);

    function dash() { return "—"; }
  }

  function renderSavingsTransfers() {
    const list = $("savingsTransfers");
    list.replaceChildren();

    const transfers = state.savings.data?.transfers || [];

    if (!transfers.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = state.savings.data
        ? "No transfers yet. Move money into your savings wallet using the form above."
        : "Loading transfers.";
      list.appendChild(empty);
      return;
    }

    transfers.slice(0, 10).forEach((item) => {
      const row = document.createElement("div");
      row.className = "income-activity-row";

      const left = document.createElement("div");

      const name = document.createElement("p");
      name.className = "income-activity-name";
      name.textContent = item.note || "Transfer to savings wallet";

      const date = document.createElement("span");
      date.className = "income-activity-date";
      date.textContent = formatDate(item.date);

      left.append(name, date);

      const right = document.createElement("div");
      right.className = "savings-activity-right";

      const amount = document.createElement("strong");
      amount.className = "income-activity-amount";
      amount.textContent = `+${money(item.amount)}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-expense-button";
      remove.textContent = "Remove";
      remove.dataset.deleteTransfer = item.id;
      remove.setAttribute("aria-label", `Remove transfer of ${money(item.amount)} on ${formatDate(item.date)}`);

      right.append(amount, remove);
      row.append(left, right);
      list.appendChild(row);
    });
  }

  function renderSavingsChart() {
    const canvas = $("savingsChart");
    if (!canvas || typeof Chart === "undefined") return;

    if (state.savingsChart) state.savingsChart.destroy();

    const all = state.savings.data?.months || [];
    const months = state.savingsRange === "all" ? all : all.slice(-Number(state.savingsRange));

    const hasData = months.some((item) => item.income || item.expenses || item.target !== null);
    const selected = state.savingsMonth;

    const emptyPlugin = {
      id: "savingsEmptyMessage",
      afterDraw(chart) {
        if (hasData || !chart.chartArea) return;

        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#858b85";
        ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(
          state.savings.data ? "Add income and expenses to see your savings trend" : "Loading",
          (chartArea.left + chartArea.right) / 2,
          (chartArea.top + chartArea.bottom) / 2
        );
        ctx.restore();
      }
    };

    state.savingsChart = new Chart(canvas, {
      type: "bar",
      plugins: [emptyPlugin],
      data: {
        labels: months.map((item) => shortMonthLabel(item.month)),
        datasets: [
          {
            type: "bar",
            label: "Actual savings",
            data: months.map((item) => item.saved),
            backgroundColor: months.map((item) => {
              const chosen = item.month === selected;
              if (item.saved < 0) return chosen ? "#b8845f" : "#d1a58a";
              return chosen ? "#405c48" : "#91a88e";
            }),
            borderRadius: 4,
            maxBarThickness: 42,
            order: 2
          },
          {
            type: "line",
            label: "Monthly goal",
            data: months.map((item) => item.target),
            borderColor: "#5f7a8a",
            backgroundColor: "#5f7a8a",
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            spanGaps: false,
            tension: 0,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick(_event, elements) {
          if (!elements.length) return;
          const chosen = months[elements[0].index];
          if (!chosen) return;
          state.savingsMonth = chosen.month;
          renderSavings();
        },
        onHover(event, elements) {
          if (event.native?.target) {
            event.native.target.style.cursor = elements.length ? "pointer" : "default";
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (value) => compactMoney(value) } }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, padding: 14, boxWidth: 8, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label(context) {
                if (context.raw === null || context.raw === undefined) return null;
                return `${context.dataset.label}: ${money(context.raw)}`;
              }
            }
          }
        }
      }
    });

    const targetMonths = months.filter((item) => item.target !== null && item.month <= localDate().slice(0, 7));
    const met = targetMonths.filter((item) => item.status === "met").length;

    setText(
      "savingsChartHint",
      !hasData
        ? ""
        : targetMonths.length
          ? `You met your goal in ${met} of ${targetMonths.length} month${targetMonths.length === 1 ? "" : "s"} with a goal. Select a bar to view that month.`
          : "Set a monthly goal to compare your savings against it. Select a bar to view that month."
    );
  }

  function showFormError(id, message) {
    const element = $(id);
    if (!element) return;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function changeSavingsMonth(monthKey) {
    state.savingsMonth = monthKey;
    showFormError("savingsGoalError", "");
    renderSavings();
  }

  $("savingsPrevMonth")?.addEventListener("click", () => changeSavingsMonth(shiftMonth(state.savingsMonth, -1)));
  $("savingsNextMonth")?.addEventListener("click", () => changeSavingsMonth(shiftMonth(state.savingsMonth, 1)));
  $("savingsThisMonth")?.addEventListener("click", () => changeSavingsMonth(localDate().slice(0, 7)));

  $("savingsRange")?.addEventListener("change", (event) => {
    state.savingsRange = event.target.value;
    renderSavingsChart();
  });

  $("savingsRetry")?.addEventListener("click", loadSavings);

  $("savingsHistory")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-month]");
    if (!button) return;
    changeSavingsMonth(button.dataset.selectMonth);
    $("savingsMonthLabel").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $("savingsGoalForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError("savingsGoalError", "");

    const amount = Number($("savingsTargetAmount").value);

    if (!Number.isFinite(amount) || amount <= 0) {
      showFormError("savingsGoalError", "Enter a goal greater than zero.");
      $("savingsTargetAmount").focus();
      return;
    }

    const monthKey = state.savingsMonth;
    const button = $("savingsGoalSubmit");
    button.disabled = true;

    try {
      await api("PUT", `/api/savings/targets/${monthKey}`, { target: amount });
      $("savingsTargetAmount").blur();
      await loadSavings();
      showToast(`Goal for ${formatMonth(monthKey)} saved: ${money(amount)}`);
    } catch (error) {
      showFormError("savingsGoalError", error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("savingsRemoveTarget")?.addEventListener("click", async () => {
    const monthKey = state.savingsMonth;

    if (!window.confirm(`Remove the savings goal for ${formatMonth(monthKey)}? Your income, expenses and wallet are not affected.`)) return;

    showFormError("savingsGoalError", "");

    try {
      await api("DELETE", `/api/savings/targets/${monthKey}`);
      await loadSavings();
      showToast("Goal removed");
    } catch (error) {
      showFormError("savingsGoalError", error.message);
    }
  });

  $("savingsTransferForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError("savingsTransferError", "");

    const amount = Number($("savingsTransferAmount").value);
    const date = $("savingsTransferDate").value;
    const note = $("savingsTransferNote").value.trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      showFormError("savingsTransferError", "Enter an amount greater than zero.");
      $("savingsTransferAmount").focus();
      return;
    }

    if (!date || date > localDate()) {
      showFormError("savingsTransferError", "Choose a date that is not in the future.");
      $("savingsTransferDate").focus();
      return;
    }

    const button = $("savingsTransferSubmit");
    button.disabled = true;

    try {
      await api("POST", "/api/savings/transfers", { amount, date, note });
      $("savingsTransferAmount").value = "";
      $("savingsTransferNote").value = "";
      await loadSavings();
      loadGoals();
      showToast(`${money(amount)} moved to your savings wallet`);
    } catch (error) {
      showFormError("savingsTransferError", error.message);
    } finally {
      renderSavings();
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-transfer]");
    if (!button) return;

    if (!window.confirm("Remove this transfer? The amount returns to your available balance.")) return;

    try {
      await api("DELETE", `/api/savings/transfers/${button.dataset.deleteTransfer}`);
      await loadSavings();
      loadGoals();
      showToast("Transfer removed");
    } catch (error) {
      showToast(error.message);
    }
  });

  // Small DOM helpers shared by the goals and breakdown sections

  function buildEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function signedMoney(value) {
    return `${value < 0 ? "-" : "+"}${money(Math.abs(value))}`;
  }

  // Savings goals
  //
  // A goal is funded by allocating money from the savings wallet. Allocating
  // never changes monthly savings or the spending balance; it only earmarks
  // wallet money. The server enforces that allocations never exceed the wallet.

  const GOAL_STATUS = {
    completed: ["Completed", "met"],
    on_track: ["On track", "met"],
    behind: ["Behind plan", "missed"],
    overdue: ["Overdue", "missed"],
    no_plan: ["No plan yet", "none"]
  };

  async function loadGoals() {
    const token = ++state.goalsRequest;

    try {
      const data = await api("GET", `/api/goals?today=${localDate()}`);
      if (token !== state.goalsRequest) return;
      state.goals = { status: "ready", data, message: "" };
    } catch (error) {
      if (token !== state.goalsRequest) return;
      state.goals = { status: "error", data: state.goals.data, message: error.message };
    }

    renderGoals();
  }

  // Every goal mutation returns the full goal list and pool.
  function applyGoalData(data) {
    state.goalsRequest += 1; // ignore any older request still in flight
    state.goals = { status: "ready", data: { goals: data.goals, pool: data.pool }, message: "" };
    renderGoals();
    loadSavings(); // the savings wallet balance changes when money moves to or from a goal
  }

  function goalPlanText(goal) {
    const rest = money(goal.remaining);

    if (goal.status === "completed") return "Fully funded.";

    if (goal.status === "overdue") return `The deadline has passed and ${rest} is still needed.`;

    if (goal.status === "no_plan") {
      return `About ${money(goal.requiredPerMonth)} a month is needed to finish on time. Add a monthly contribution to track your plan.`;
    }

    if (goal.status === "on_track") {
      return `Needs ${money(goal.requiredPerMonth)} a month. Your plan of ${money(goal.monthlyContribution)} a month should finish around ${formatMonth(goal.projectedCompletion)}.`;
    }

    if (goal.monthsLeft === 0) return `Due this month, with ${rest} still needed.`;

    return `Needs ${money(goal.requiredPerMonth)} a month, but your plan is ${money(goal.monthlyContribution)}. At that pace it would finish around ${formatMonth(goal.projectedCompletion)}, after the deadline.`;
  }

  function deadlineText(goal) {
    const date = formatDate(goal.deadline);
    if (goal.status === "completed") return `Deadline ${date}`;
    if (goal.status === "overdue") return `Was due ${date}`;
    if (goal.monthsLeft === 0) return `Due ${date}, this month`;
    return `Due ${date}, ${goal.monthsLeft} month${goal.monthsLeft === 1 ? "" : "s"} left`;
  }

  function buildGoalCard(goal, index, count) {
    const [statusLabel, statusClass] = GOAL_STATUS[goal.status];
    const card = buildEl("article", `goal-card goal-${goal.status}`);
    card.dataset.goalId = goal.id;

    const head = buildEl("div", "goal-card-head");
    head.appendChild(buildEl("span", "goal-rank", String(goal.priority)));

    const title = buildEl("div", "goal-title");
    title.appendChild(buildEl("h4", "", goal.name));
    title.appendChild(buildEl("span", "goal-deadline", deadlineText(goal)));
    head.appendChild(title);
    head.appendChild(buildEl("span", `status-badge status-${statusClass}`, statusLabel));
    card.appendChild(head);

    const track = buildEl("div", "savings-progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `Progress toward ${goal.name}`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.round(goal.progressPercent)));
    const fill = buildEl("div", `savings-progress-fill fill-${statusClass}`);
    fill.style.width = `${goal.progressPercent}%`;
    track.appendChild(fill);
    card.appendChild(track);

    const figures = buildEl("div", "goal-figures");
    figures.appendChild(buildEl("strong", "", `${money(goal.allocated)} of ${money(goal.target)}`));
    figures.appendChild(buildEl("span", "", `${goal.progressPercent}%`));
    card.appendChild(figures);

    card.appendChild(buildEl("p", "goal-plan", goalPlanText(goal)));

    const allocate = buildEl("div", "goal-allocate");
    const input = buildEl("input");
    input.type = "number";
    input.min = "0.01";
    input.step = "0.01";
    input.placeholder = "Amount (₹)";
    input.inputMode = "decimal";
    input.setAttribute("aria-label", `Amount to allocate to ${goal.name}`);
    allocate.appendChild(input);

    const add = buildEl("button", "button button-primary", "Allocate");
    add.type = "button";
    add.dataset.goalAction = "allocate";
    add.disabled = goal.status === "completed";

    const release = buildEl("button", "button button-secondary", "Release");
    release.type = "button";
    release.dataset.goalAction = "release";
    release.disabled = goal.allocated <= 0;

    allocate.append(add, release);
    card.appendChild(allocate);

    const error = buildEl("p", "field-error goal-card-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    card.appendChild(error);

    const actions = buildEl("div", "goal-actions");
    [
      ["up", "Move up", index === 0],
      ["down", "Move down", index === count - 1],
      ["edit", "Edit", false],
      ["delete", "Delete", false]
    ].forEach(([action, label, disabled]) => {
      const button = buildEl("button", `text-button${action === "delete" ? " danger" : ""}`, label);
      button.type = "button";
      button.dataset.goalAction = action;
      button.disabled = disabled;
      button.setAttribute("aria-label", `${label}: ${goal.name}`);
      actions.appendChild(button);
    });
    card.appendChild(actions);

    return card;
  }

  function renderGoals() {
    if (!$("goals")) return;

    const { status, data } = state.goals;

    $("goalsError").hidden = status !== "error";
    setText("goalsErrorText", state.goals.message || "Goals could not be loaded.");

    const pool = data?.pool;
    setText("goalsWallet", pool ? money(pool.walletBalance) : "—");
    setText("goalsAllocated", pool ? money(pool.allocated) : "—");
    setText("goalsTotal", pool ? money(pool.totalSaved) : "—");

    const goals = data?.goals || [];
    const canDistribute = Boolean(pool) && pool.walletBalance > 0 && goals.some((g) => g.status !== "completed");
    $("goalsAutoAllocate").disabled = !canDistribute;

    let help = "";
    if (pool) {
      if (!goals.length) help = "Create a goal to start allocating your savings.";
      else if (pool.totalSaved <= 0) help = "Your savings wallet is empty. Move money into it from the Savings section first.";
      else if (pool.walletBalance <= 0) help = "All of your savings are allocated to goals. Move more into the wallet from the Savings section.";
      else if (!canDistribute) help = "Every goal is already fully funded.";
      else help = `Fills your highest priority goal first, then the next. ${money(pool.walletBalance)} is in your savings wallet.`;
    }
    setText("goalsPoolHelp", help);

    const list = $("goalList");
    list.replaceChildren();

    if (!data) {
      list.appendChild(buildEl("p", "muted", status === "error" ? "Goals are unavailable right now." : "Loading your goals."));
      return;
    }

    if (!goals.length) {
      const empty = buildEl("div", "goal-empty");
      empty.appendChild(buildEl("h3", "", "No goals yet"));
      empty.appendChild(buildEl("p", "", "Create your first goal, such as a laptop, a trip or an emergency fund, and set a target and deadline."));
      list.appendChild(empty);
      return;
    }

    goals.forEach((goal, index) => list.appendChild(buildGoalCard(goal, index, goals.length)));
  }

  let editingGoalId = null;

  function openGoalDialog(goal) {
    editingGoalId = goal ? goal.id : null;

    setText("goalDialogTitle", goal ? "Edit goal" : "New goal");
    $("goalName").value = goal ? goal.name : "";
    $("goalTarget").value = goal ? String(goal.target) : "";
    $("goalDeadline").value = goal ? goal.deadline : "";
    $("goalMonthly").value = goal && goal.monthlyContribution ? String(goal.monthlyContribution) : "";

    // New goals need a future deadline; an existing overdue goal may keep its date.
    if (!goal || goal.deadline >= localDate()) $("goalDeadline").min = localDate();
    else $("goalDeadline").removeAttribute("min");

    showFormError("goalFormError", "");
    openDialog($("goalDialog"));
    $("goalName").focus();
  }

  $("goalNew")?.addEventListener("click", () => openGoalDialog(null));
  $("goalCancel")?.addEventListener("click", () => closeDialog($("goalDialog")));
  $("goalsRetry")?.addEventListener("click", loadGoals);

  $("goalForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError("goalFormError", "");

    const name = $("goalName").value.trim();
    const target = Number($("goalTarget").value);
    const deadline = $("goalDeadline").value;
    const monthlyText = $("goalMonthly").value.trim();
    const monthly = monthlyText === "" ? null : Number(monthlyText);

    if (!name) return showFormError("goalFormError", "Give your goal a name.");
    if (!Number.isFinite(target) || target <= 0) return showFormError("goalFormError", "Enter a target amount greater than zero.");
    if (!deadline) return showFormError("goalFormError", "Choose a deadline.");
    if (monthly !== null && (!Number.isFinite(monthly) || monthly <= 0)) {
      return showFormError("goalFormError", "The monthly contribution must be greater than zero, or left empty.");
    }

    const button = $("goalSave");
    button.disabled = true;

    try {
      const body = { name, target, deadline, monthlyContribution: monthly };
      const data = editingGoalId
        ? await api("PUT", `/api/goals/${editingGoalId}`, body)
        : await api("POST", "/api/goals", body);

      applyGoalData(data);
      closeDialog($("goalDialog"));
      showToast(editingGoalId ? "Goal updated" : `Goal "${name}" created`);
    } catch (error) {
      showFormError("goalFormError", error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("goalsAutoAllocate")?.addEventListener("click", async () => {
    const button = $("goalsAutoAllocate");
    button.disabled = true;

    try {
      const data = await api("POST", "/api/goals/auto-allocate");
      applyGoalData(data);
      showToast(data.distributed > 0
        ? `${money(data.distributed)} distributed across your goals`
        : "Nothing to distribute");
    } catch (error) {
      showToast(error.message);
      renderGoals();
    }
  });

  $("goalList")?.addEventListener("input", (event) => {
    const error = event.target.closest(".goal-card")?.querySelector(".goal-card-error");
    if (error) error.hidden = true;
  });

  $("goalList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-goal-action]");
    if (!button || button.disabled) return;

    const card = button.closest(".goal-card");
    const id = card.dataset.goalId;
    const goals = state.goals.data?.goals || [];
    const goal = goals.find((item) => item.id === id);
    if (!goal) return;

    const action = button.dataset.goalAction;
    const cardError = card.querySelector(".goal-card-error");

    try {
      if (action === "edit") {
        openGoalDialog(goal);
      } else if (action === "up" || action === "down") {
        const ids = goals.map((item) => item.id);
        const from = ids.indexOf(id);
        const to = action === "up" ? from - 1 : from + 1;
        if (to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        applyGoalData(await api("POST", "/api/goals/reorder", { ids }));
      } else if (action === "delete") {
        const returned = goal.allocated > 0
          ? ` The ${money(goal.allocated)} allocated to it goes back to your savings wallet.`
          : "";
        if (!window.confirm(`Delete the goal "${goal.name}"?${returned}`)) return;
        applyGoalData(await api("DELETE", `/api/goals/${id}`));
        showToast("Goal deleted");
      } else if (action === "allocate" || action === "release") {
        const input = card.querySelector("input");
        const amount = Number(input.value);

        if (!Number.isFinite(amount) || amount <= 0) {
          cardError.textContent = "Enter an amount greater than zero.";
          cardError.hidden = false;
          input.focus();
          return;
        }

        button.disabled = true;
        applyGoalData(await api("POST", `/api/goals/${id}/${action}`, { amount }));
        showToast(action === "allocate"
          ? `${money(amount)} allocated to ${goal.name}`
          : `${money(amount)} released from ${goal.name}`);
      }
    } catch (error) {
      if (cardError && document.body.contains(cardError)) {
        cardError.textContent = error.message;
        cardError.hidden = false;
        button.disabled = false;
      } else {
        showToast(error.message);
      }
    }
  });

  // Spending breakdown

  async function loadBreakdown() {
    const token = ++state.breakdownRequest;

    try {
      const data = await api(
        "GET",
        `/api/breakdown?month=${state.breakdownMonth}&reduce=${state.breakdownReduce}`
      );
      if (token !== state.breakdownRequest) return;
      state.breakdown = { status: "ready", data, message: "" };
    } catch (error) {
      if (token !== state.breakdownRequest) return;
      state.breakdown = { status: "error", data: state.breakdown.data, message: error.message };
    }

    renderBreakdown();
  }

  function changeText(item) {
    if (item.trend === "new") return "New this month";
    if (item.trend === "same") return "No change";
    const percent = item.changePercent === null ? "" : ` (${item.changePercent > 0 ? "+" : ""}${item.changePercent}%)`;
    return `${signedMoney(item.change)}${percent}`;
  }

  function renderBreakdown() {
    if (!$("breakdown")) return;

    const { status, data } = state.breakdown;
    const currentMonth = localDate().slice(0, 7);

    $("breakdownError").hidden = status !== "error";
    setText("breakdownErrorText", state.breakdown.message || "The breakdown could not be loaded.");
    setText("breakdownLabel", formatMonth(state.breakdownMonth));
    $("breakdownThis").hidden = state.breakdownMonth === currentMonth;
    $("breakdownReduce").value = String(state.breakdownReduce);

    const dash = "—";

    if (!data) {
      ["bdIncome", "bdExpenses", "bdNet", "bdDiscretionary", "bdMonthlySaving", "bdYearlySaving", "bdAfter"]
        .forEach((id) => setText(id, dash));
      ["bdExpensesNote", "bdNetNote", "bdDiscretionaryNote", "breakdownReduceNote"].forEach((id) => setText(id, ""));

      const loading = status === "error" ? "The breakdown is unavailable right now." : "Loading.";
      ["breakdownIncreases", "breakdownCategories", "breakdownIncome"].forEach((id) => {
        $(id).replaceChildren(buildEl("p", "muted", loading));
      });
      renderBreakdownChart();
      return;
    }

    const previous = formatMonth(data.previousMonth);
    const expenses = data.expenses;

    // Summary cards
    setText("bdIncome", money(data.income.total));
    setText("bdExpenses", money(expenses.total));
    setText("bdNet", money(data.net));
    $("bdNet").classList.toggle("negative", data.net < 0);
    setText("bdDiscretionary", money(data.discretionary.total));

    setText(
      "bdExpensesNote",
      expenses.previousTotal === 0
        ? `No spending recorded in ${previous}`
        : expenses.change === 0
          ? `Same as ${previous}`
          : `${expenses.change > 0 ? "Up" : "Down"} ${money(Math.abs(expenses.change))} (${expenses.changePercent > 0 ? "+" : ""}${expenses.changePercent}%) from ${previous}`
    );
    $("bdExpensesNote").classList.toggle("trend-up-text", expenses.change > 0 && expenses.previousTotal > 0);

    setText(
      "bdNetNote",
      data.savingsRatePercent === null ? "No income recorded this month" : `Savings rate ${data.savingsRatePercent}%`
    );
    setText(
      "bdDiscretionaryNote",
      expenses.total > 0 ? `${data.discretionary.sharePercent}% of your spending` : "No spending this month"
    );

    // What changed
    const box = $("breakdownIncreases");
    box.replaceChildren();

    if (expenses.previousTotal === 0 && expenses.total === 0) {
      box.appendChild(buildEl("p", "muted", "No expenses recorded for this month or the one before."));
    } else if (expenses.previousTotal === 0) {
      box.appendChild(buildEl("p", "muted", `No spending was recorded in ${previous}, so there is nothing to compare with yet.`));
    } else if (!data.increases.length) {
      box.appendChild(buildEl("p", "muted", `Spending did not rise in any category compared with ${previous}.`));
    } else {
      const count = data.increases.length;
      box.appendChild(buildEl("p", "breakdown-lead",
        `Spending rose in ${count === 1 ? "this category" : `these ${count} categories`} compared with ${previous}:`));

      const list = buildEl("ul", "increase-list");
      data.increases.forEach((item) => {
        const row = buildEl("li");
        row.appendChild(buildEl("strong", "", item.category));
        row.appendChild(buildEl("span", "trend-badge trend-up", changeText(item)));
        list.appendChild(row);
      });
      box.appendChild(list);
    }

    // Category table
    const tableBox = $("breakdownCategories");
    tableBox.replaceChildren();

    if (!expenses.categories.length) {
      tableBox.appendChild(buildEl("p", "muted", "No expenses recorded for this month."));
    } else {
      const table = buildEl("table", "breakdown-table-grid");
      const head = buildEl("thead");
      const headRow = buildEl("tr");
      ["Category", "Spent", "Share", previous, "Change"].forEach((label) => headRow.appendChild(buildEl("th", "", label)));
      head.appendChild(headRow);

      const body = buildEl("tbody");
      expenses.categories.forEach((item) => {
        const row = buildEl("tr", item.trend === "up" || item.trend === "new" ? "row-up" : "");

        const name = buildEl("td", "category-cell");
        const swatch = buildEl("span", "category-swatch");
        swatch.style.background = categoryColors[categoryLabels.indexOf(item.category)] || "#8b8980";
        name.append(swatch, document.createTextNode(item.category));
        if (item.discretionary) name.appendChild(buildEl("span", "discretionary-tag", "Discretionary"));

        const spent = buildEl("td", "", money(item.amount));

        const share = buildEl("td", "share-cell");
        const bar = buildEl("div", "share-bar");
        const barFill = buildEl("div", "share-bar-fill");
        barFill.style.width = `${Math.min(100, item.sharePercent)}%`;
        bar.appendChild(barFill);
        share.append(bar, buildEl("span", "", `${item.sharePercent}%`));

        const before = buildEl("td", "", money(item.previous));

        const change = buildEl("td");
        change.appendChild(buildEl("span", `trend-badge trend-${item.trend}`, item.trend === "new" ? "New" : changeText(item)));

        row.append(name, spent, share, before, change);
        body.appendChild(row);
      });

      table.append(head, body);
      tableBox.appendChild(table);
    }

    // Income sources
    const incomeBox = $("breakdownIncome");
    incomeBox.replaceChildren();

    if (!data.income.sources.length) {
      incomeBox.appendChild(buildEl("p", "muted", "No income recorded for this month."));
    } else {
      data.income.sources.forEach((source) => {
        const row = buildEl("div", "income-source-row");
        const top = buildEl("div", "income-source-top");
        top.append(buildEl("span", "", source.name), buildEl("strong", "", money(source.amount)));
        const bar = buildEl("div", "share-bar");
        const barFill = buildEl("div", "share-bar-fill income");
        barFill.style.width = `${Math.min(100, source.sharePercent)}%`;
        bar.appendChild(barFill);
        row.append(top, bar, buildEl("span", "income-source-share", `${source.sharePercent}% of income`));
        incomeBox.appendChild(row);
      });
    }

    // Discretionary controls (rebuilt only when the saved selection changes)
    const checks = $("discretionaryChecks");
    const signature = data.discretionary.categories.join("|");

    if (checks.dataset.signature !== signature || !checks.children.length) {
      checks.dataset.signature = signature;
      checks.replaceChildren();

      categoryLabels.forEach((label) => {
        const wrapper = buildEl("label", "check-item");
        const input = buildEl("input");
        input.type = "checkbox";
        input.value = label;
        input.checked = data.discretionary.categories.includes(label);
        wrapper.append(input, document.createTextNode(label));
        checks.appendChild(wrapper);
      });
    }

    const d = data.discretionary;
    setText("bdMonthlySaving", money(d.monthlySaving));
    setText("bdYearlySaving", money(d.yearlySaving));
    setText("bdAfter", money(d.savingsAfterReduction));

    setText(
      "breakdownReduceNote",
      !d.categories.length
        ? "Choose at least one category to see an estimate."
        : d.total === 0
          ? "There is no spending in your discretionary categories this month, so there is nothing to reduce."
          : `Cutting ${d.reducePercent}% from ${money(d.total)} of discretionary spending would change this month's savings from ${money(data.net)} to ${money(d.savingsAfterReduction)}.`
    );

    renderBreakdownChart();
  }

  function renderBreakdownChart() {
    const canvas = $("breakdownChart");
    if (!canvas || typeof Chart === "undefined") return;

    if (state.breakdownChart) state.breakdownChart.destroy();

    const data = state.breakdown.data;
    const categories = data ? data.expenses.categories : [];
    const previous = data ? formatMonth(data.previousMonth) : "Last month";

    const emptyPlugin = {
      id: "breakdownEmptyMessage",
      afterDraw(chart) {
        if (categories.length || !chart.chartArea) return;
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#858b85";
        ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(
          data ? "No expenses to compare" : "Loading",
          (chartArea.left + chartArea.right) / 2,
          (chartArea.top + chartArea.bottom) / 2
        );
        ctx.restore();
      }
    };

    state.breakdownChart = new Chart(canvas, {
      type: "bar",
      plugins: [emptyPlugin],
      data: {
        labels: categories.map((item) => item.category),
        datasets: [
          {
            label: data ? formatMonth(data.month) : "This month",
            data: categories.map((item) => item.amount),
            backgroundColor: "#55745d",
            borderRadius: 4,
            maxBarThickness: 34
          },
          {
            label: previous,
            data: categories.map((item) => item.previous),
            backgroundColor: "#c9cfc6",
            borderRadius: 4,
            maxBarThickness: 34
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (value) => compactMoney(value) } }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, padding: 14, boxWidth: 8, font: { size: 11 } }
          },
          tooltip: {
            callbacks: { label: (context) => `${context.dataset.label}: ${money(context.raw)}` }
          }
        }
      }
    });
  }

  function changeBreakdownMonth(monthKey) {
    state.breakdownMonth = monthKey;
    loadBreakdown();
    renderBreakdown();
  }

  $("breakdownPrev")?.addEventListener("click", () => changeBreakdownMonth(shiftMonth(state.breakdownMonth, -1)));
  $("breakdownNext")?.addEventListener("click", () => changeBreakdownMonth(shiftMonth(state.breakdownMonth, 1)));
  $("breakdownThis")?.addEventListener("click", () => changeBreakdownMonth(localDate().slice(0, 7)));
  $("breakdownRetry")?.addEventListener("click", loadBreakdown);

  $("breakdownReduce")?.addEventListener("change", (event) => {
    state.breakdownReduce = Number(event.target.value);
    loadBreakdown();
  });

  $("discretionaryChecks")?.addEventListener("change", async () => {
    const categories = [...$("discretionaryChecks").querySelectorAll("input:checked")].map((input) => input.value);

    try {
      await api("PUT", "/api/settings/discretionary", { categories });
      await loadBreakdown();
    } catch (error) {
      showToast(error.message);
      $("discretionaryChecks").dataset.signature = "";
      renderBreakdown();
    }
  });

  // Daily pleasures

  function defaultPleasures() {
    return DEFAULT_PLEASURES.map((item) => ({ id: createId(), ...item }));
  }

  function normalizePleasures(list) {
    if (!Array.isArray(list)) return [];

    return list
      .filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        item.name.trim() &&
        Number.isFinite(Number(item.amount)) &&
        Number(item.amount) > 0
      )
      .map((item) => ({
        id: item.id,
        name: item.name.trim().slice(0, 40),
        emoji: String(item.emoji || "⭐"),
        amount: Number(item.amount),
        category: categoryLabels.includes(item.category) ? item.category : "Other",
        payment: PAYMENT_METHODS.includes(item.payment) ? item.payment : "Other"
      }));
  }

  // Saved in the background; the tiles update immediately.
  function savePleasures() {
    api("PUT", "/api/pleasures", { pleasures: state.pleasures }).catch((error) => {
      showToast(`Daily pleasures could not be saved: ${error.message}`);
    });

    return true;
  }

  function pleasurePrice(amount) {
    return Number.isInteger(amount) ? `₹${amount}` : money(amount);
  }

  function pleasureDay() {
    return state.pleasureDate || localDate();
  }

  function renderPleasures() {
    const grid = $("pleasureGrid");
    if (!grid) return;

    const date = pleasureDay();
    const dayExpenses = expensesForDate(date);

    const counts = new Map();
    dayExpenses.forEach((expense) => {
      if (expense.pleasureId) {
        counts.set(expense.pleasureId, (counts.get(expense.pleasureId) || 0) + 1);
      }
    });

    // Re-rendering replaces the buttons, so remember which one had focus.
    const active = document.activeElement;
    let focusSelector = null;

    if (active && grid.contains(active)) {
      if (active.dataset.pleasure) {
        focusSelector = `[data-pleasure="${CSS.escape(active.dataset.pleasure)}"]`;
      } else if (active.hasAttribute("data-add-pleasure")) {
        focusSelector = "[data-add-pleasure]";
      }
    }

    grid.replaceChildren();
    grid.classList.toggle("editing", state.pleasureEdit);

    state.pleasures.forEach((item) => {
      const tile = document.createElement("div");
      tile.className = "pleasure-tile";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "pleasure-main";
      main.dataset.pleasure = item.id;

      const count = counts.get(item.id) || 0;

      main.setAttribute(
        "aria-label",
        state.pleasureEdit
          ? `Edit ${item.name}`
          : `Add ${item.name}, ${pleasurePrice(item.amount)}${count ? `, logged ${count} time${count === 1 ? "" : "s"} on this day` : ""}`
      );

      if (state.poppedPleasure === item.id) main.classList.add("pop");

      const emoji = document.createElement("span");
      emoji.className = "pleasure-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = item.emoji;

      const name = document.createElement("span");
      name.className = "pleasure-name";
      name.textContent = item.name;

      const price = document.createElement("span");
      price.className = "pleasure-price";
      price.textContent = pleasurePrice(item.amount);

      main.append(emoji, name, price);
      tile.appendChild(main);

      if (count && !state.pleasureEdit) {
        const badge = document.createElement("span");
        badge.className = "pleasure-count";
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = `×${count}`;
        tile.appendChild(badge);
      }

      if (state.pleasureEdit) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "pleasure-remove";
        remove.dataset.removePleasure = item.id;
        remove.setAttribute("aria-label", `Remove ${item.name}`);
        remove.textContent = "×";
        tile.appendChild(remove);
      }

      grid.appendChild(tile);
    });

    state.poppedPleasure = null;

    const add = document.createElement("button");
    add.type = "button";
    add.className = "pleasure-add";
    add.dataset.addPleasure = "true";

    const plus = document.createElement("span");
    plus.className = "pleasure-emoji";
    plus.setAttribute("aria-hidden", "true");
    plus.textContent = "+";

    const addLabel = document.createElement("span");
    addLabel.className = "pleasure-name";
    addLabel.textContent = "Add new";

    add.append(plus, addLabel);
    grid.appendChild(add);

    if (focusSelector) grid.querySelector(focusSelector)?.focus();

    const summary = $("pleasureSummary");

    if (summary) {
      if (state.pleasureEdit) {
        summary.textContent =
          "Tap a tile to change it, or × to remove it. Expenses already logged stay as they are.";
      } else {
        const lead = date === localDate() ? "Today so far" : formatDate(date);
        const n = dayExpenses.length;

        summary.textContent = n
          ? `${lead}: ${money(total(dayExpenses))} across ${n} expense${n === 1 ? "" : "s"}.`
          : `${lead}: nothing logged yet.`;
      }
    }
  }

  // Toast with undo

  let toastTimer = null;

  function hideToast() {
    clearTimeout(toastTimer);
    const toast = $("toast");
    if (!toast) return;
    toast.classList.remove("visible");
    toast.replaceChildren();
  }

  function showToast(message, onUndo) {
    const toast = $("toast");
    if (!toast) return;

    toast.replaceChildren();

    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);

    if (onUndo) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "toast-undo";
      undo.textContent = "Undo";
      undo.addEventListener("click", () => {
        onUndo();
        hideToast();
      });
      toast.appendChild(undo);
    }

    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  // Tapping a tile logs an expense

  async function tapPleasure(id) {
    const item = state.pleasures.find((p) => p.id === id);
    if (!item) return;

    const date = pleasureDay();

    let expense;

    try {
      ({ expense } = await api("POST", "/api/expenses", {
        description: item.name,
        amount: item.amount,
        date,
        category: item.category,
        payment: item.payment,
        source: "pleasure",
        pleasureId: item.id
      }));
    } catch (error) {
      showToast(error.message);
      return;
    }

    state.expenses.push(expense);

    state.poppedPleasure = item.id;
    refreshAll();

    const where = date === localDate() ? "today" : formatDate(date);

    showToast(
      `${item.emoji} ${item.name} ${pleasurePrice(item.amount)} added to ${where}`,
      async () => {
        try {
          await api("DELETE", `/api/expenses/${expense.id}`);
          state.expenses = state.expenses.filter((e) => e.id !== expense.id);
          refreshAll();
        } catch (error) {
          showToast(error.message);
        }
      }
    );
  }

  // Add / edit / remove tiles

  function openPleasureEditor(id) {
    const dialog = $("pleasureDialog");
    if (!dialog) return;

    const item = id ? state.pleasures.find((p) => p.id === id) : null;
    state.editingPleasureId = item ? item.id : null;

    $("pleasureDialogTitle").textContent =
      item ? "Edit daily pleasure" : "Add a daily pleasure";

    $("pleasureEmoji").value = item ? item.emoji : "";
    $("pleasureName").value = item ? item.name : "";
    $("pleasureAmount").value = item ? String(item.amount) : "";
    $("pleasureCategory").value = item ? item.category : "Food";
    $("pleasurePayment").value = item ? item.payment : "Cash";

    dialog.showModal();
    $("pleasureName").focus();
  }

  function removePleasure(id) {
    const item = state.pleasures.find((p) => p.id === id);
    if (!item) return;

    if (!window.confirm(`Remove ${item.name} from your daily pleasures? Expenses you've already logged will stay.`)) {
      return;
    }

    state.pleasures = state.pleasures.filter((p) => p.id !== id);
    savePleasures();
    renderPleasures();
  }

  $("pleasureGrid")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-pleasure]");

    if (remove) {
      removePleasure(remove.dataset.removePleasure);
      return;
    }

    if (event.target.closest("[data-add-pleasure]")) {
      openPleasureEditor(null);
      return;
    }

    const tile = event.target.closest("[data-pleasure]");
    if (!tile) return;

    if (state.pleasureEdit) {
      openPleasureEditor(tile.dataset.pleasure);
    } else {
      tapPleasure(tile.dataset.pleasure);
    }
  });

  $("pleasureEditToggle")?.addEventListener("click", () => {
    state.pleasureEdit = !state.pleasureEdit;

    const toggle = $("pleasureEditToggle");
    toggle.textContent = state.pleasureEdit ? "Done" : "Edit";
    toggle.setAttribute("aria-pressed", String(state.pleasureEdit));

    renderPleasures();
  });

  $("pleasureDate")?.addEventListener("change", (event) => {
    state.pleasureDate = event.target.value || localDate();
    state.pleasureDateAuto = state.pleasureDate === localDate();

    if (!event.target.value) event.target.value = state.pleasureDate;

    renderPleasures();
  });

  $("pleasureToday")?.addEventListener("click", () => {
    state.pleasureDate = localDate();
    state.pleasureDateAuto = true;
    $("pleasureDate").value = state.pleasureDate;
    renderPleasures();
  });

  // If the tab stays open past midnight, "today" should roll over.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.pleasureDateAuto) return;

    const today = localDate();

    if (state.pleasureDate !== today) {
      state.pleasureDate = today;
      if ($("pleasureDate")) $("pleasureDate").value = today;
      renderPleasures();
    }
  });

  $("pleasureCancel")?.addEventListener("click", () => {
    $("pleasureDialog").close();
  });

  $("pleasureForm")?.addEventListener("submit", (event) => {
    event.preventDefault();

    const emoji = $("pleasureEmoji").value.trim();
    const name = $("pleasureName").value.trim();
    const amount = Number($("pleasureAmount").value);

    if (!emoji) {
      alert("Pick or type an icon.");
      $("pleasureEmoji").focus();
      return;
    }

    if (!name) {
      alert("Please enter a name.");
      $("pleasureName").focus();
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Please enter a price greater than zero.");
      $("pleasureAmount").focus();
      return;
    }

    const values = {
      emoji,
      name,
      amount,
      category: $("pleasureCategory").value,
      payment: $("pleasurePayment").value
    };

    const existing = state.pleasures.find(
      (p) => p.id === state.editingPleasureId
    );

    if (existing) {
      Object.assign(existing, values);
    } else {
      state.pleasures.push({ id: createId(), ...values });
    }

    savePleasures();
    $("pleasureDialog").close();
    renderPleasures();
  });

  function initPleasures() {
    const category = $("pleasureCategory");
    categoryLabels.forEach((label) => category?.add(new Option(label, label)));

    const payment = $("pleasurePayment");
    PAYMENT_METHODS.forEach((label) => payment?.add(new Option(label, label)));

    const suggestions = $("emojiSuggestions");

    EMOJI_SUGGESTIONS.forEach((emoji) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "emoji-suggestion";
      button.textContent = emoji;
      button.setAttribute("aria-label", `Use ${emoji}`);
      button.addEventListener("click", () => {
        $("pleasureEmoji").value = emoji;
      });
      suggestions?.appendChild(button);
    });

    if ($("pleasureDate")) $("pleasureDate").value = state.pleasureDate;
  }

  // Refresh the app

  function refreshAll() {
    renderWallet();
    renderSavings();
    loadSavings();
    loadBreakdown();
    renderSummary();
    renderTransactions();
    renderPleasures();

    const periodData = buildPeriodData();

    if (
      !periodData.some(
        (item) => item.key === state.selectedPeriodKey
      )
    ) {
      state.selectedPeriodKey = periodData.length
        ? periodData[periodData.length - 1].key
        : null;
    }

    renderPeriodChart();
    renderCategoryChart();

    if (state.detailMonth && !$("monthDetail").hidden) {
      renderMonthDetail();
    }
  }

  // Initial setup

  async function bootstrap() {
    try {
      const data = await api("GET", "/api/bootstrap");

      state.user = data.user;
      state.expenses = data.expenses;
      state.incomes = data.incomes;
      state.monthlyIncomeDefault = data.settings.monthlyIncomeDefault || 0;
      state.transfersTotal = data.transfersTotal || 0;

      if (data.settings.pleasures) {
        state.pleasures = normalizePleasures(data.settings.pleasures);
      } else {
        state.pleasures = defaultPleasures();
        savePleasures();
      }

      setText("userEmail", state.user.email);
      $("appError").hidden = true;

      if ($("incomeAmount") && state.monthlyIncomeDefault > 0) {
        $("incomeAmount").value = String(state.monthlyIncomeDefault);
      }

      renderIncomeCalendar();
      renderIncomeDateEntries();
      refreshAll();
      loadGoals();
      renderGoals();
    } catch (error) {
      setText("appErrorText", error.message || "Your data could not be loaded.");
      $("appError").hidden = false;
    }
  }

  $("appRetry")?.addEventListener("click", bootstrap);

  $("logoutButton")?.addEventListener("click", async () => {
    try {
      await api("POST", "/api/auth/logout");
    } finally {
      window.location.assign("/login");
    }
  });

  initPleasures();
  renderIncomeCalendar();
  renderIncomeDateEntries();
  bootstrap();
});
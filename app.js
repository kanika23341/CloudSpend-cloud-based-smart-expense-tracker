document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = "cloudspend_expenses_v1";
  const INCOME_STORAGE_KEY = "cloudspend_income_entries_v1";
  const MONTHLY_INCOME_KEY = "cloudspend_monthly_income_default_v1";

  const state = {
    expenses: loadExpenses(),
    incomes: loadIncomes(),
    monthlyIncomeDefault: loadMonthlyIncomeDefault(),
    incomeCalendarMonth: localDate().slice(0, 7),
    selectedIncomeDate: localDate(),
    period: "monthly",
    selectedPeriodKey: null,
    detailMonth: null,
    selectedDates: new Set(),
    periodChart: null,
    categoryChart: null,
    detailCategoryChart: null
  };

  const categoryColors = [
    "#55745d", "#91a88e", "#c4b99b", "#a7b6bd",
    "#d1a58a", "#879b83", "#c9cfc6", "#8b8980"
  ];

  const categoryLabels = [
    "Food", "Bills", "Transport", "Education",
    "Health", "Entertainment", "Shopping", "Other"
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
    return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }

  function createId() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Expense storage

  function loadExpenses() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) return [];

      return saved.filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.date === "string" &&
        Number.isFinite(Number(item.amount)) &&
        Number(item.amount) > 0
      );
    } catch {
      return [];
    }
  }

  function saveExpenses() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
    } catch (error) {
      console.error("Could not save expenses:", error);
      alert("Expenses could not be saved in this browser.");
    }
  }

  // Income storage

  function loadIncomes() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(INCOME_STORAGE_KEY) || "[]"
      );

      if (!Array.isArray(saved)) return [];

      return saved.filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.date === "string" &&
        typeof item.description === "string" &&
        Number.isFinite(Number(item.amount)) &&
        Number(item.amount) > 0
      );
    } catch {
      return [];
    }
  }

  function saveIncomes() {
    try {
      localStorage.setItem(
        INCOME_STORAGE_KEY,
        JSON.stringify(state.incomes)
      );
      return true;
    } catch (error) {
      console.error("Could not save income entries:", error);
      alert("Income could not be saved in this browser. Check browser storage.");
      return false;
    }
  }

  function loadMonthlyIncomeDefault() {
    try {
      const amount = Number(
        localStorage.getItem(MONTHLY_INCOME_KEY) || 0
      );

      return Number.isFinite(amount) && amount > 0 ? amount : 0;
    } catch {
      return 0;
    }
  }

  function saveMonthlyIncomeDefault(amount) {
    try {
      localStorage.setItem(MONTHLY_INCOME_KEY, String(amount));
      state.monthlyIncomeDefault = amount;
      return true;
    } catch (error) {
      console.error("Could not save monthly income amount:", error);
      alert("The monthly income amount could not be saved in this browser.");
      return false;
    }
  }

  function incomeTotal(items = state.incomes) {
    return items.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );
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

    const balance = incomeTotal() - total(state.expenses);

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
    oldChart
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

    return new Chart(canvas, {
      type: "doughnut",
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

  function renderDetailCategoryChart() {
    if (!state.detailMonth) return;

    state.detailCategoryChart = createCategoryChart(
      $("detailCategoryChart"),
      expensesForMonth(state.detailMonth),
      "Monthly categories",
      "Category totals for this month.",
      state.detailCategoryChart
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

  $("expense-form")?.addEventListener("submit", (event) => {
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

    state.expenses.push({
      id: createId(),
      description,
      amount,
      date,
      category,
      payment
    });

    saveExpenses();

    event.target.reset();
    $("date").value = localDate();

    refreshAll();
  });

  // Delete expenses

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-expense]");
    if (!button) return;

    const id = button.dataset.deleteExpense;

    if (!window.confirm("Delete this expense?")) return;

    state.expenses = state.expenses.filter(
      (expense) => expense.id !== id
    );

    saveExpenses();
    refreshAll();
  });

  // Save monthly income default

  $("monthlyIncomeForm")?.addEventListener("submit", (event) => {
    event.preventDefault();

    const amount = Number($("monthlyIncomeAmount").value);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a monthly income amount greater than zero.");
      $("monthlyIncomeAmount").focus();
      return;
    }

    if (saveMonthlyIncomeDefault(amount)) {
      if ($("incomeAmount")) {
        $("incomeAmount").value = String(amount);
      }

      refreshAll();

      alert(
        "Monthly income amount saved. Choose Add income to record it on the calendar and add it to your wallet."
      );
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

  $("incomeEntryForm")?.addEventListener("submit", (event) => {
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

    const entry = {
      id: createId(),
      description,
      amount,
      date,
      createdAt: new Date().toISOString()
    };

    state.incomes.push(entry);

    if (!saveIncomes()) {
      state.incomes = state.incomes.filter(
        (item) => item.id !== entry.id
      );
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

  // Refresh the app

  function refreshAll() {
    renderWallet();
    renderSummary();
    renderTransactions();

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

  if ($("incomeAmount") && state.monthlyIncomeDefault > 0) {
    $("incomeAmount").value = String(state.monthlyIncomeDefault);
  }

  renderIncomeCalendar();
  renderIncomeDateEntries();
  refreshAll();
});
/**
 * CloudSpend — Analytics & Chart.js Visualizations Module
 */

const AnalyticsModule = {
  chartTrends: null,
  chartBreakdown: null,
  chartQuarterly: null,

  init() {
    // Chart.js global typography styling
    if (window.Chart) {
      Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      Chart.defaults.color = '#4A504B';
    }
  },

  async loadAnalytics(year, month) {
    if (!AuthModule.currentUser) {
      this.clearCharts();
      return;
    }

    try {
      const [trendsRes, breakdownRes, quarterlyRes] = await Promise.all([
        API.get('/api/analytics/trends?months=6'),
        API.get(`/api/analytics/breakdown?startDate=${year}-${String(month).padStart(2, '0')}-01&endDate=${year}-${String(month).padStart(2, '0')}-31&type=expense`),
        API.get(`/api/analytics/quarterly?year=${year}`)
      ]);

      this.renderTrendsChart(trendsRes.trends || []);
      this.renderBreakdownChart(breakdownRes.breakdown || []);
      this.renderQuarterlyChart(quarterlyRes.quarters || []);
      this.renderTopCategories(breakdownRes.breakdown || []);
    } catch (err) {
      console.warn('[Analytics] Load error:', err);
    }
  },

  clearCharts() {
    if (this.chartTrends) this.chartTrends.destroy();
    if (this.chartBreakdown) this.chartBreakdown.destroy();
    if (this.chartQuarterly) this.chartQuarterly.destroy();
    document.getElementById('analytics-top-categories').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Sign in to view analytics</div>
      </div>
    `;
  },

  renderTrendsChart(trends) {
    const canvas = document.getElementById('chart-trends');
    if (!canvas || !window.Chart) return;

    if (this.chartTrends) {
      this.chartTrends.destroy();
    }

    const labels = trends.map(t => t.label);
    const incomeData = trends.map(t => t.income);
    const expenseData = trends.map(t => t.expense);

    this.chartTrends = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Income',
            data: incomeData,
            backgroundColor: '#2D5A43', // Muted forest green
            borderRadius: 4
          },
          {
            label: 'Expenses',
            data: expenseData,
            backgroundColor: '#A84236', // Muted terracotta
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${API.formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (val) => `₹${val}`
            }
          }
        }
      }
    });
  },

  renderBreakdownChart(breakdown) {
    const canvas = document.getElementById('chart-breakdown');
    if (!canvas || !window.Chart) return;

    if (this.chartBreakdown) {
      this.chartBreakdown.destroy();
    }

    if (!breakdown || breakdown.length === 0) {
      return;
    }

    const labels = breakdown.map(b => b.category);
    const data = breakdown.map(b => b.total);

    // Muted, tasteful palette
    const colors = [
      '#2D5A43', '#A84236', '#B87326', '#3D6B5B',
      '#6C757D', '#546A7B', '#8E5A44', '#7D8471',
      '#9B6A6C', '#4F6367'
    ];

    this.chartBreakdown = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors.slice(0, labels.length),
            borderColor: '#FFFFFF',
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${API.formatCurrency(ctx.parsed)}`
            }
          }
        },
        cutout: '65%'
      }
    });
  },

  renderQuarterlyChart(quarters) {
    const canvas = document.getElementById('chart-quarterly');
    if (!canvas || !window.Chart) return;

    if (this.chartQuarterly) {
      this.chartQuarterly.destroy();
    }

    const labels = quarters.map(q => q.quarter);
    const incomeData = quarters.map(q => q.income);
    const expenseData = quarters.map(q => q.expense);

    this.chartQuarterly = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Income',
            data: incomeData,
            backgroundColor: '#2D5A43',
            borderRadius: 4
          },
          {
            label: 'Expenses',
            data: expenseData,
            backgroundColor: '#A84236',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${API.formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (val) => `₹${val}`
            }
          }
        }
      }
    });
  },

  renderTopCategories(breakdown) {
    const container = document.getElementById('analytics-top-categories');
    if (!container) return;

    if (!breakdown || breakdown.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No spending data for this period</div>
          <p class="empty-state-desc">Transactions will automatically be aggregated here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = breakdown.slice(0, 6).map((item, idx) => `
      <div style="margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 2px;">
          <span><strong>#${idx + 1}</strong> ${item.category} (${item.count} txns)</span>
          <span class="num"><strong>${API.formatCurrency(item.total)}</strong> (${item.percentage}%)</span>
        </div>
        <div class="progress-container" style="height: 6px;">
          <div class="progress-bar" style="width: ${item.percentage}%; background-color: var(--primary);"></div>
        </div>
      </div>
    `).join('');
  }
};

window.AnalyticsModule = AnalyticsModule;

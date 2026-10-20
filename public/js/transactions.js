/**
 * CloudSpend — Transactions Management Module
 */

const TransactionsModule = {
  currentPage: 1,
  limit: 15,
  currentFilters: {
    type: '',
    category: '',
    paymentMethod: '',
    search: '',
    startDate: '',
    endDate: ''
  },
  knownCategories: new Set(),

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const newBtn = document.getElementById('tx-btn-new');
    const newExpenseBtn = document.getElementById('tx-btn-new-expense');
    const newIncomeBtn = document.getElementById('tx-btn-new-income');
    const pillExpense = document.getElementById('tx-pill-expense');
    const pillIncome = document.getElementById('tx-pill-income');

    const modal = document.getElementById('tx-modal');
    const closeBtn = document.getElementById('tx-modal-close');
    const cancelBtn = document.getElementById('tx-btn-cancel');
    const form = document.getElementById('tx-form');
    const receiptFile = document.getElementById('tx-receipt-file');
    const descInput = document.getElementById('tx-desc');
    const catInput = document.getElementById('tx-category');

    const searchInput = document.getElementById('tx-search-input');
    const typeFilter = document.getElementById('tx-filter-type');
    const catFilter = document.getElementById('tx-filter-category');
    const methodFilter = document.getElementById('tx-filter-method');
    const resetBtn = document.getElementById('tx-btn-reset-filters');

    const prevBtn = document.getElementById('tx-prev-page');
    const nextBtn = document.getElementById('tx-next-page');

    if (newBtn) {
      newBtn.addEventListener('click', () => {
        if (!AuthModule.currentUser) AuthModule.openModal('login');
        else this.openCreateModal('expense');
      });
    }

    if (newExpenseBtn) {
      newExpenseBtn.addEventListener('click', () => {
        if (!AuthModule.currentUser) AuthModule.openModal('login');
        else this.openCreateModal('expense');
      });
    }

    if (newIncomeBtn) {
      newIncomeBtn.addEventListener('click', () => {
        if (!AuthModule.currentUser) AuthModule.openModal('login');
        else this.openCreateModal('income');
      });
    }

    if (pillExpense) {
      pillExpense.addEventListener('click', () => this.setType('expense'));
    }

    if (pillIncome) {
      pillIncome.addEventListener('click', () => this.setType('income'));
    }

    // Smart auto-detect income/expense as user types
    const checkAutoDetect = () => {
      const text = `${descInput?.value || ''} ${catInput?.value || ''}`.toLowerCase();
      const incomeKeywords = ['salary', 'paycheck', 'freelance', 'dividend', 'bonus', 'consulting', 'stipend', 'interest', 'refund', 'cashback', 'income'];
      const expenseKeywords = ['groceries', 'dinner', 'lunch', 'bill', 'rent', 'recharge', 'uber', 'ola', 'shopping', 'medicine', 'coffee'];

      if (incomeKeywords.some(k => text.includes(k))) {
        this.setType('income');
      } else if (expenseKeywords.some(k => text.includes(k))) {
        this.setType('expense');
      }
    };

    if (descInput) descInput.addEventListener('input', checkAutoDetect);
    if (catInput) catInput.addEventListener('input', checkAutoDetect);

    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
    if (form) form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Search debounce
    let searchTimeout;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.currentFilters.search = e.target.value.trim();
          this.currentPage = 1;
          this.loadTransactions();
        }, 300);
      });
    }

    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        this.currentFilters.type = e.target.value;
        this.currentPage = 1;
        this.loadTransactions();
      });
    }

    if (catFilter) {
      catFilter.addEventListener('change', (e) => {
        this.currentFilters.category = e.target.value;
        this.currentPage = 1;
        this.loadTransactions();
      });
    }

    if (methodFilter) {
      methodFilter.addEventListener('change', (e) => {
        this.currentFilters.paymentMethod = e.target.value;
        this.currentPage = 1;
        this.loadTransactions();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (typeFilter) typeFilter.value = '';
        if (catFilter) catFilter.value = '';
        if (methodFilter) methodFilter.value = '';
        this.currentFilters = { type: '', category: '', paymentMethod: '', search: '', startDate: '', endDate: '' };
        this.currentPage = 1;
        this.loadTransactions();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.loadTransactions();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.currentPage++;
        this.loadTransactions();
      });
    }

    if (receiptFile) {
      receiptFile.addEventListener('change', (e) => this.handleReceiptSelection(e));
    }
  },

  async loadTransactions() {
    if (!AuthModule.currentUser) {
      this.renderTable([]);
      return;
    }

    const params = new URLSearchParams({
      page: this.currentPage,
      limit: this.limit,
      ...this.currentFilters
    });

    try {
      const res = await API.get(`/api/transactions?${params.toString()}`);
      this.renderTable(res.data || []);
      this.renderPagination(res.pagination);

      // Collect categories for filter dropdown
      (res.data || []).forEach(t => {
        if (t.category) this.knownCategories.add(t.category);
      });
      this.updateCategoryFilterDropdown();
    } catch (err) {
      console.warn('[Transactions] Error loading transactions:', err);
    }
  },

  renderTable(transactions) {
    const tbody = document.getElementById('tx-table-body');
    const emptyState = document.getElementById('tx-empty-state');
    const table = document.getElementById('tx-table');

    if (!transactions || transactions.length === 0) {
      tbody.innerHTML = '';
      table.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';

    tbody.innerHTML = transactions.map(t => {
      const isExpense = t.type === 'expense';
      const receiptCell = t.receipt_url
        ? `<a href="/api/receipts/view?key=${encodeURIComponent(t.receipt_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="padding: 2px 6px;">View 📎</a>`
        : '<span style="color: var(--text-muted);">&mdash;</span>';

      return `
        <tr>
          <td>${API.formatDate(t.date)}</td>
          <td><strong>${t.description}</strong></td>
          <td><span class="badge badge-neutral">${t.category}</span></td>
          <td><span style="font-size: 0.8125rem; color: var(--text-secondary);">${t.payment_method || 'Debit Card'}</span></td>
          <td>${receiptCell}</td>
          <td style="text-align: right;" class="num ${isExpense ? 'expense' : 'income'}">
            <strong>${isExpense ? '-' : '+'}${API.formatCurrency(t.amount)}</strong>
          </td>
          <td style="text-align: center; white-space: nowrap;">
            <button class="btn btn-secondary btn-sm" onclick="TransactionsModule.openEditModal('${t.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="TransactionsModule.deleteTransaction('${t.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderPagination(pagination) {
    if (!pagination) return;
    const info = document.getElementById('tx-pagination-info');
    const current = document.getElementById('tx-current-page');
    const prevBtn = document.getElementById('tx-prev-page');
    const nextBtn = document.getElementById('tx-next-page');

    const total = pagination.total;
    const page = pagination.page;
    const totalPages = pagination.totalPages || 1;

    info.textContent = `Showing page ${page} of ${totalPages} (${total} total records)`;
    current.textContent = `Page ${page}`;

    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
  },

  updateCategoryFilterDropdown() {
    const select = document.getElementById('tx-filter-category');
    if (!select) return;

    const currentVal = select.value;
    const options = ['<option value="">All Categories</option>'];
    Array.from(this.knownCategories).sort().forEach(cat => {
      options.push(`<option value="${cat}" ${cat === currentVal ? 'selected' : ''}>${cat}</option>`);
    });
    select.innerHTML = options.join('');
  },

  setType(type) {
    const isIncome = type === 'income';
    const typeInput = document.getElementById('tx-type');
    const pillExpense = document.getElementById('tx-pill-expense');
    const pillIncome = document.getElementById('tx-pill-income');
    const hint = document.getElementById('tx-type-hint');
    const amountLabel = document.getElementById('tx-amount-label');
    const datalist = document.getElementById('category-datalist');

    if (typeInput) typeInput.value = isIncome ? 'income' : 'expense';

    if (pillExpense && pillIncome) {
      if (isIncome) {
        pillIncome.style.borderColor = 'var(--primary)';
        pillIncome.style.backgroundColor = 'var(--primary-light)';
        pillIncome.style.color = 'var(--primary)';

        pillExpense.style.borderColor = 'var(--border-color)';
        pillExpense.style.backgroundColor = 'var(--bg-surface)';
        pillExpense.style.color = 'var(--text-secondary)';
      } else {
        pillExpense.style.borderColor = 'var(--danger)';
        pillExpense.style.backgroundColor = 'var(--danger-light)';
        pillExpense.style.color = 'var(--danger)';

        pillIncome.style.borderColor = 'var(--border-color)';
        pillIncome.style.backgroundColor = 'var(--bg-surface)';
        pillIncome.style.color = 'var(--text-secondary)';
      }
    }

    if (hint) {
      if (isIncome) {
        hint.innerHTML = '🟢 <strong>Income Inflow</strong>: This will increase your monthly income and available cash.';
        hint.style.color = 'var(--primary)';
      } else {
        hint.innerHTML = '🔴 <strong>Expense Outflow</strong>: This will count towards your monthly spending.';
        hint.style.color = 'var(--danger)';
      }
    }

    if (amountLabel) {
      amountLabel.textContent = isIncome ? 'Income Amount (₹)' : 'Expense Amount (₹)';
    }

    // Populate category datalist according to active type
    if (datalist) {
      const expenseCats = [
        'Groceries', 'Housing & Rent', 'Dining Out', 'Utilities',
        'Transportation', 'Healthcare', 'Entertainment', 'Shopping', 'Other Expense'
      ];
      const incomeCats = [
        'Salary', 'Freelance', 'Business / Consulting', 'Investments & Dividends',
        'Rental Income', 'Cashback / Refund', 'Bonus', 'Other Income'
      ];
      const cats = isIncome ? incomeCats : expenseCats;
      datalist.innerHTML = cats.map(c => `<option value="${c}">`).join('');
    }
  },

  openCreateModal(defaultType = 'expense') {
    const modal = document.getElementById('tx-modal');
    const title = document.getElementById('tx-modal-title');
    const form = document.getElementById('tx-form');

    form.reset();
    document.getElementById('tx-id').value = '';
    document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('tx-receipt-url').value = '';
    document.getElementById('tx-receipt-filename').value = '';
    document.getElementById('tx-receipt-preview').style.display = 'none';

    this.setType(defaultType);

    title.textContent = defaultType === 'income' ? 'Record Income (+)' : 'Record Expense (-)';
    modal.classList.add('active');
  },

  async openEditModal(id) {
    try {
      const res = await API.get(`/api/transactions/${id}`);
      const t = res.transaction;

      document.getElementById('tx-id').value = t.id;
      this.setType(t.type);

      document.getElementById('tx-amount').value = t.amount;
      document.getElementById('tx-desc').value = t.description;
      document.getElementById('tx-category').value = t.category;
      document.getElementById('tx-date').value = t.date;
      document.getElementById('tx-payment-method').value = t.payment_method;
      document.getElementById('tx-receipt-url').value = t.receipt_url || '';
      document.getElementById('tx-receipt-filename').value = t.receipt_filename || '';

      const preview = document.getElementById('tx-receipt-preview');
      const previewName = document.getElementById('tx-receipt-preview-name');
      if (t.receipt_filename || t.receipt_url) {
        preview.style.display = 'block';
        previewName.textContent = t.receipt_filename || t.receipt_url;
      } else {
        preview.style.display = 'none';
      }

      document.getElementById('tx-modal-title').textContent = t.type === 'income' ? 'Edit Income (+)' : 'Edit Expense (-)';
      document.getElementById('tx-modal').classList.add('active');
    } catch (err) {
      API.toast('Failed to load transaction details: ' + err.message, 'error');
    }
  },

  closeModal() {
    const modal = document.getElementById('tx-modal');
    if (modal) modal.classList.remove('active');
  },

  async handleReceiptSelection(e) {
    const file = e.target.files[0];
    if (!file) return;

    API.toast('Uploading receipt...', 'info');

    try {
      // Step 1: Check if S3 Presigned URL is supported
      const presignRes = await API.post('/api/receipts/presign-upload', {
        filename: file.name,
        contentType: file.type || 'image/jpeg'
      });

      if (presignRes.s3Configured && presignRes.uploadUrl) {
        // Direct browser PUT to Amazon S3
        await fetch(presignRes.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'image/jpeg' },
          body: file
        });

        document.getElementById('tx-receipt-url').value = presignRes.key;
        document.getElementById('tx-receipt-filename').value = file.name;
        API.toast('Receipt uploaded to Amazon S3!', 'success');
      } else {
        // Local upload fallback via multer
        const formData = new FormData();
        formData.append('receipt', file);

        const uploadRes = await API.post('/api/receipts/upload-local', formData);
        document.getElementById('tx-receipt-url').value = uploadRes.receiptUrl;
        document.getElementById('tx-receipt-filename').value = uploadRes.receiptFilename;
        API.toast('Receipt uploaded locally.', 'success');
      }

      const preview = document.getElementById('tx-receipt-preview');
      const previewName = document.getElementById('tx-receipt-preview-name');
      preview.style.display = 'block';
      previewName.textContent = file.name;
    } catch (err) {
      API.toast('Receipt upload failed: ' + err.message, 'error');
    }
  },

  async handleSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('tx-btn-save');
    saveBtn.disabled = true;

    const id = document.getElementById('tx-id').value;
    const payload = {
      type: document.getElementById('tx-type').value,
      amount: parseFloat(document.getElementById('tx-amount').value),
      description: document.getElementById('tx-desc').value.trim(),
      category: document.getElementById('tx-category').value.trim(),
      date: document.getElementById('tx-date').value,
      paymentMethod: document.getElementById('tx-payment-method').value,
      receiptUrl: document.getElementById('tx-receipt-url').value || null,
      receiptFilename: document.getElementById('tx-receipt-filename').value || null
    };

    try {
      if (id) {
        await API.put(`/api/transactions/${id}`, payload);
        API.toast('Transaction updated successfully.', 'success');
      } else {
        await API.post('/api/transactions', payload);
        API.toast('Transaction recorded successfully.', 'success');
      }

      this.closeModal();
      this.loadTransactions();
      App.refreshAll();
    } catch (err) {
      API.toast(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  },

  async deleteTransaction(id) {
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    try {
      await API.delete(`/api/transactions/${id}`);
      API.toast('Transaction deleted.', 'info');
      this.loadTransactions();
      App.refreshAll();
    } catch (err) {
      API.toast('Failed to delete transaction: ' + err.message, 'error');
    }
  }
};

window.TransactionsModule = TransactionsModule;

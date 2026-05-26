const STORAGE_KEY = "otmaher-tax-data-v1";
const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"sales":[],"expenses":[],"manualExpenses":[]}');

const fmt = (n) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n || 0);
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function calcSale(gross) {
  const net = round(gross / 1.10);
  const vat = round(gross - net);
  return { net, vat };
}

function calcExpense(gross, vatRate) {
  const net = round(gross / (1 + vatRate));
  const vat = round(gross - net);
  return { net, vat };
}

function computeProgressiveTax(profit) {
  if (profit <= 0) return 0;
  const brackets = [
    { limit: 158000, rate: 0.15 },
    { limit: 330000, rate: 0.20 },
    { limit: 800000, rate: 0.27 },
    { limit: 4300000, rate: 0.35 },
    { limit: Infinity, rate: 0.40 }
  ];
  let remain = profit, prev = 0, tax = 0;
  for (const b of brackets) {
    const taxable = Math.min(remain, b.limit - prev);
    if (taxable <= 0) continue;
    tax += taxable * b.rate;
    remain -= taxable;
    prev = b.limit;
    if (remain <= 0) break;
  }
  return round(tax);
}

function summary() {
  const totalGrossSales = state.sales.reduce((s, x) => s + x.gross, 0);
  const totalNetSales = state.sales.reduce((s, x) => s + x.net, 0);
  const salesVat = state.sales.reduce((s, x) => s + x.vat, 0);

  const totalGrossExpense = state.expenses.reduce((s, x) => s + x.gross, 0);
  const totalNetExpense = state.expenses.reduce((s, x) => s + x.net, 0);
  const deductibleVat = state.expenses.reduce((s, x) => s + x.vat, 0);
  const manualExpense = state.manualExpenses.reduce((s, x) => s + x.amount, 0);

  const payableVat = round(salesVat - deductibleVat);
  const netProfit = round(totalNetSales - totalNetExpense - manualExpense);
  const tempTax = computeProgressiveTax(netProfit) / 4;

  return { totalGrossSales, totalNetSales, totalGrossExpense, deductibleVat, payableVat, netProfit, tempTax };
}

function quarterKey(dateString) {
  const d = new Date(dateString);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()} Q${q}`;
}

function render() {
  const s = summary();
  const dashboard = document.getElementById('dashboard');
  dashboard.innerHTML = [
    ['Toplam Ciro', fmt(s.totalGrossSales)],
    ['KDV Hariç Ciro', fmt(s.totalNetSales)],
    ['Toplam Gider', fmt(s.totalGrossExpense)],
    ['İndirilecek KDV', fmt(s.deductibleVat)],
    ['Ödenecek KDV', fmt(s.payableVat)],
    ['Net Ticari Kâr', fmt(s.netProfit)],
    ['Tahmini Geçici Vergi', fmt(s.tempTax)]
  ].map(([k,v]) => `<div>${k}<strong>${v}</strong></div>`).join('');

  document.querySelector('#salesTable tbody').innerHTML = state.sales
    .sort((a,b) => a.date.localeCompare(b.date))
    .map(x => `<tr><td>${x.date}</td><td>${x.platform}</td><td>${fmt(x.gross)}</td><td>${x.orders}</td><td>${fmt(x.net)}</td></tr>`).join('');

  const combinedExpenses = [
    ...state.expenses.map(e => ({ ...e, source: e.vendor })),
    ...state.manualExpenses.map(m => ({ date: m.date, source: 'Manuel', category: m.category, gross: m.amount, vat: 0, net: m.amount }))
  ].sort((a,b) => a.date.localeCompare(b.date));

  document.querySelector('#expensesTable tbody').innerHTML = combinedExpenses
    .map(x => `<tr><td>${x.date}</td><td>${x.source}</td><td>${x.category}</td><td>${fmt(x.gross)}</td><td>${fmt(x.vat)}</td><td>${fmt(x.net)}</td></tr>`).join('');

  const quarters = {};
  for (const sale of state.sales) {
    const key = quarterKey(sale.date);
    quarters[key] ??= { salesVat: 0, netSales: 0, netExp: 0, manual: 0 };
    quarters[key].salesVat += sale.vat;
    quarters[key].netSales += sale.net;
  }
  for (const ex of state.expenses) {
    const key = quarterKey(ex.date);
    quarters[key] ??= { salesVat: 0, netSales: 0, netExp: 0, manual: 0 };
    quarters[key].salesVat -= ex.vat;
    quarters[key].netExp += ex.net;
  }
  for (const man of state.manualExpenses) {
    const key = quarterKey(man.date);
    quarters[key] ??= { salesVat: 0, netSales: 0, netExp: 0, manual: 0 };
    quarters[key].manual += man.amount;
  }

  document.querySelector('#taxTable tbody').innerHTML = Object.entries(quarters)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([period, q]) => {
      const profit = round(q.netSales - q.netExp - q.manual);
      const tax = round(computeProgressiveTax(profit) / 4);
      return `<tr><td>${period}</td><td>${fmt(q.salesVat)}</td><td>${fmt(tax)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('');
}

saleForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const gross = Number(fd.get('gross'));
  const { net, vat } = calcSale(gross);
  state.sales.push({ date: fd.get('date'), platform: fd.get('platform'), gross, orders: Number(fd.get('orders') || 0), net, vat });
  persist(); render(); e.target.reset();
});

expenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const gross = Number(fd.get('gross'));
  const vatRate = Number(fd.get('vatRate'));
  const { net, vat } = calcExpense(gross, vatRate);
  state.expenses.push({ date: fd.get('date'), vendor: fd.get('vendor'), category: fd.get('category'), gross, vat, net, vatRate });
  persist(); render(); e.target.reset();
});

manualExpenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  state.manualExpenses.push({ date: fd.get('date'), category: fd.get('category'), amount: Number(fd.get('amount')) });
  persist(); render(); e.target.reset();
});

render();

/* Ruang Dana starter: penyimpanan lokal. Firebase belum dihubungkan. */
"use strict";

const STORAGE_KEY = "ruangDanaDataV1";
const DEFAULTS = {
  income: 2000000,
  allocations: { investasi: 20, tabungan: 20, darurat: 10, bebas: 50 },
  transactions: []
};
const labels = { investasi: "Investasi", tabungan: "Tabungan", darurat: "Dana darurat", bebas: "Uang bebas pakai" };
let state = loadState();

const $ = (id) => document.getElementById(id);
const rupiah = (value) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(value);

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.allocations || !Array.isArray(parsed.transactions)) return cloneDefaults();
    return {
      income: Number.isFinite(Number(parsed.income)) && Number(parsed.income) >= 0 ? Number(parsed.income) : DEFAULTS.income,
      allocations: { ...DEFAULTS.allocations, ...parsed.allocations },
      transactions: parsed.transactions.filter(t => t && typeof t.id === "string" && labels[t.category] && ["income","expense"].includes(t.type) && Number.isFinite(t.amount) && t.amount > 0)
    };
  } catch {
    return cloneDefaults();
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function totalFor(category, type) {
  return state.transactions.filter(t => t.category === category && t.type === type).reduce((sum, t) => sum + t.amount, 0);
}
function allocated(category) {
  return state.income * Number(state.allocations[category] || 0) / 100;
}
function balance(category) {
  return allocated(category) + totalFor(category, "income") - totalFor(category, "expense");
}
function setMessage(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `message ${kind}`;
}
function renderAllocations() {
  const container = $("allocations");
  container.replaceChildren();
  for (const category of Object.keys(labels)) {
    const card = document.createElement("div");
    card.className = "allocation";
    const label = document.createElement("label");
    label.textContent = labels[category];
    label.htmlFor = `allocation-${category}`;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.id = `allocation-${category}`;
    input.value = state.allocations[category];
    input.setAttribute("aria-label", `Persentase ${labels[category]}`);
    const amount = document.createElement("div");
    amount.className = "amount";
    amount.textContent = rupiah(allocated(category));
    input.addEventListener("input", () => {
      const n = Number(input.value);
      amount.textContent = Number.isFinite(n) && n >= 0 && n <= 100 ? rupiah(state.income * n / 100) : "Persentase tidak valid";
    });
    card.append(label, input, amount);
    container.append(card);
  }
}
function renderTransactions() {
  const tbody = $("transactions");
  tbody.replaceChildren();
  const rows = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  $("emptyState").hidden = rows.length > 0;
  for (const t of rows) {
    const tr = document.createElement("tr");
    const date = document.createElement("td"); date.textContent = t.date;
    const detail = document.createElement("td"); detail.textContent = `${t.type === "expense" ? "Pengeluaran" : "Pemasukan"}${t.note ? ` · ${t.note}` : ""}`;
    const category = document.createElement("td"); category.textContent = labels[t.category];
    const amount = document.createElement("td"); amount.textContent = `${t.type === "expense" ? "−" : "+"}${rupiah(t.amount)}`;
    const action = document.createElement("td");
    const del = document.createElement("button");
    del.className = "delete-button"; del.type = "button"; del.textContent = "Hapus";
    del.setAttribute("aria-label", `Hapus transaksi ${t.note || labels[t.category]}`);
    del.addEventListener("click", () => {
      if (!confirm("Hapus transaksi ini? Saldo kategori akan dihitung ulang.")) return;
      state.transactions = state.transactions.filter(item => item.id !== t.id);
      saveState(); render(); setMessage("transactionMessage", "Transaksi dihapus dan saldo dihitung ulang.", "success");
    });
    action.append(del); tr.append(date, detail, category, amount, action); tbody.append(tr);
  }
}
function renderSummary() {
  const spent = state.transactions.filter(t => t.type === "expense").reduce((s,t) => s+t.amount, 0);
  const freeSpent = totalFor("bebas", "expense");
  const freeAllocated = allocated("bebas");
  $("totalIncome").textContent = rupiah(state.income + state.transactions.filter(t => t.type === "income").reduce((s,t) => s+t.amount, 0));
  $("totalSpent").textContent = rupiah(spent);
  $("freeRemaining").textContent = rupiah(balance("bebas"));
  $("freeUsed").textContent = freeAllocated > 0 ? `${Math.round(freeSpent / freeAllocated * 100)}%` : (freeSpent > 0 ? "—" : "0%");
  $("income").value = state.income;
}
function render() { renderAllocations(); renderTransactions(); renderSummary(); }

$("income").addEventListener("change", () => {
  const value = Number($("income").value);
  if (!Number.isFinite(value) || value < 0) {
    $("income").value = state.income;
    setMessage("allocationMessage", "Pendapatan harus berupa angka nol atau lebih.", "error");
    return;
  }
  state.income = Math.round(value);
  saveState(); render(); setMessage("allocationMessage", "Pendapatan diperbarui. Periksa kembali saldo kategori.", "success");
});
$("saveBudget").addEventListener("click", () => {
  const next = {};
  for (const category of Object.keys(labels)) {
    const n = Number($(`allocation-${category}`).value);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      setMessage("allocationMessage", "Setiap persentase harus bilangan bulat dari 0 sampai 100.", "error"); return;
    }
    next[category] = n;
  }
  const sum = Object.values(next).reduce((a,b) => a+b, 0);
  if (sum !== 100) {
    setMessage("allocationMessage", `Total persentase saat ini ${sum}%. Jumlahnya harus tepat 100%.`, "error"); return;
  }
  state.allocations = next;
  saveState(); render(); setMessage("allocationMessage", "Alokasi disimpan. Saldo dihitung ulang berdasarkan anggaran baru.", "success");
});
$("date").value = new Date().toISOString().slice(0, 10);
$("transactionForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const type = $("type").value;
  const category = $("category").value;
  const amount = Number($("amount").value);
  const date = $("date").value;
  const note = $("note").value.trim();
  if (!["income","expense"].includes(type) || !labels[category] || !Number.isSafeInteger(amount) || amount <= 0 || !date) {
    setMessage("transactionMessage", "Periksa jenis, kategori, tanggal, dan nominal transaksi.", "error"); return;
  }
  if (type === "expense" && amount > balance(category)) {
    setMessage("transactionMessage", `Transaksi ditolak. Saldo ${labels[category]} hanya ${rupiah(balance(category))}.`, "error"); return;
  }
  state.transactions.push({
    id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type, category, amount, date, note, createdAt: Date.now()
  });
  saveState(); render(); $("amount").value = ""; $("note").value = "";
  setMessage("transactionMessage", "Transaksi berhasil disimpan.", "success");
});
$("exportData").addEventListener("click", () => {
  const payload = { format: "ruang-dana-backup", version: 1, exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `ruang-dana-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  setMessage("backupMessage", "File cadangan dibuat. Simpan di tempat pribadi yang aman.", "success");
});
$("importData").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("Ukuran file terlalu besar.");
    const parsed = JSON.parse(await file.text());
    const candidate = parsed?.format === "ruang-dana-backup" ? parsed.data : parsed;
    if (!candidate || !candidate.allocations || !Array.isArray(candidate.transactions) || !Number.isFinite(Number(candidate.income)) || Number(candidate.income) < 0) throw new Error("Format cadangan tidak dikenali.");
    const allocations = {};
    for (const category of Object.keys(labels)) {
      const n = Number(candidate.allocations[category]);
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error("Persentase pada file cadangan tidak valid.");
      allocations[category] = n;
    }
    if (Object.values(allocations).reduce((a,b)=>a+b,0) !== 100) throw new Error("Total persentase cadangan harus 100%.");
    const transactions = candidate.transactions;
    for (const t of transactions) {
      if (!t || typeof t.id !== "string" || !["income","expense"].includes(t.type) || !labels[t.category] || !Number.isSafeInteger(t.amount) || t.amount <= 0 || typeof t.date !== "string") throw new Error("Ada transaksi yang tidak valid pada file.");
    }
    if (!confirm("Impor akan mengganti data saat ini. Pastikan kamu sudah membuat cadangan. Lanjutkan?")) return;
    state = { income: Math.round(Number(candidate.income)), allocations, transactions };
    saveState(); render(); setMessage("backupMessage", "Cadangan berhasil diimpor.", "success");
  } catch (error) {
    setMessage("backupMessage", error.message || "File tidak dapat diimpor.", "error");
  } finally { event.target.value = ""; }
});
render();

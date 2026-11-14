import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);

const CATEGORIES = {
  investasi: "Investasi",
  tabungan: "Tabungan",
  darurat: "Dana darurat",
  bebas: "Uang bebas pakai"
};

const DEFAULT_MONTH = {
  income: 2000000,
  allocations: { investasi: 20, tabungan: 20, darurat: 10, bebas: 50 },
  transactions: []
};

const DEFAULT_USER_PROFILE = {
  username: "",
  bio: "Menuju kebebasan finansial 🚀",
  targetAnnual: 20000000,
  avatarUrl: "",
  theme: "light"
};

const cloneDefault = () => JSON.parse(JSON.stringify(DEFAULT_MONTH));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthFromDate = date => date.slice(0, 7);
const formatMoney = n => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(n);

let activeMonth = today().slice(0, 7);
let months = { [activeMonth]: cloneDefault() };
let wallets = [];
let debts = [];
let goals = [];
let reminders = [];
let userProfile = { ...DEFAULT_USER_PROFILE };
let currentUser = null;
let unsubscribeData = null;
let dataReady = false;
let authBusy = false;
let signupMode = false;
let chartMode = "overview";
let saveQueue = Promise.resolve();

function message(id, text, kind = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `message ${kind}`;
}

function monthData(key = activeMonth) {
  if (!months[key]) months[key] = cloneDefault();
  return months[key];
}

function cleanMonth(input) {
  if (!input || typeof input !== "object") throw new Error("Format bulan tidak valid.");

  const income = Number(input.income ?? 0);
  if (!Number.isSafeInteger(income) || income < 0) {
    throw new Error("Pendapatan bulanan tidak valid.");
  }

  const allocations = {};
  for (const category of Object.keys(CATEGORIES)) {
    const value = Number(input.allocations?.[category] ?? DEFAULT_MONTH.allocations[category]);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error("Persentase anggaran tidak valid.");
    }
    allocations[category] = value;
  }

  if (Object.values(allocations).reduce((a, b) => a + b, 0) !== 100) {
    throw new Error("Total persentase anggaran harus 100%.");
  }

  const transactions = (Array.isArray(input.transactions) ? input.transactions : []).map((t, i) => {
    const amount = Number(t.amount);
    if (
      !["income", "expense"].includes(t.type) ||
      !CATEGORIES[t.category] ||
      !Number.isSafeInteger(amount) || amount <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ""))
    ) {
      throw new Error("Ada transaksi dengan data yang tidak valid.");
    }
    return {
      id: String(t.id ?? `${t.date}-${i}`),
      type: t.type,
      category: t.category,
      amount,
      date: t.date,
      note: String(t.note || "").slice(0, 120),
      walletId: typeof t.walletId === "string" ? t.walletId : ""
    };
  });

  return { income, allocations, transactions };
}

function cleanMonths(input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Data bulanan tidak valid.");
  }

  for (const [key, value] of Object.entries(input)) {
    if (!/^\d{4}-\d{2}$/.test(key)) throw new Error("Format bulan tidak valid.");
    result[key] = cleanMonth(value);
  }
  return result;
}

function saveState() {
  if (!currentUser || !dataReady) return Promise.resolve();

  const uid = currentUser.uid;
  const snapshot = JSON.parse(JSON.stringify({ months, profile: userProfile, wallets, debts, goals, reminders }));
  const ref = doc(db, "users", uid, "appData", "main");

  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      if (!currentUser || currentUser.uid !== uid) return;
      await setDoc(ref, snapshot);
    })
    .catch(error => {
      console.error("Penyimpanan cloud gagal:", error);
      message("transactionMessage", "Gagal menyinkronkan data cloud.", "error");
    });

  return saveQueue;
}

function allocation(category, key = activeMonth) {
  const d = monthData(key);
  return Math.round(d.income * d.allocations[category] / 100);
}

function transactionTotal(type, category = null, key = activeMonth) {
  return monthData(key).transactions
    .filter(t => t.type === type && (!category || t.category === category))
    .reduce((sum, t) => sum + t.amount, 0);
}

function balance(category, key = activeMonth) {
  return allocation(category, key)
    + transactionTotal("income", category, key)
    - transactionTotal("expense", category, key);
}

function calculateAllTimeBalance(category) {
  let total = 0;
  for (const key of Object.keys(months)) {
    total += balance(category, key);
  }
  return total;
}

function calculateTotalWealth() {
  let total = 0;
  for (const cat of Object.keys(CATEGORIES)) {
    total += calculateAllTimeBalance(cat);
  }
  return total;
}

function applyTheme(theme) {
  userProfile.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  // Menggunakan ikon ☼ untuk terang dan ☾ untuk gelap sesuai permintaan
  $("themeIcon").textContent = theme === "dark" ? "☼" : "☾";
  localStorage.setItem("ruangDanaTheme", theme);
}

function renderSummary() {
  const data = monthData();

  const totalWealth = calculateTotalWealth();
  const totalTabungan = calculateAllTimeBalance("tabungan");
  const totalDarurat = calculateAllTimeBalance("darurat");
  const totalInvestasi = calculateAllTimeBalance("investasi");

  $("totalWealth").textContent = formatMoney(totalWealth);
  $("totalTabungan").textContent = formatMoney(totalTabungan);
  $("totalDarurat").textContent = formatMoney(totalDarurat);
  $("totalInvestasi").textContent = formatMoney(totalInvestasi);

  $("totalIncome").textContent = formatMoney(data.income + transactionTotal("income"));
  $("totalSpent").textContent = formatMoney(transactionTotal("expense"));
  $("freeRemaining").textContent = formatMoney(balance("bebas"));

  const freeBudget = allocation("bebas");
  const freeSpent = transactionTotal("expense", "bebas");
  $("freeUsed").textContent = `${freeBudget ? Math.round(freeSpent / freeBudget * 100) : (freeSpent ? 100 : 0)}%`;

  $("budgetIncome").value = data.income;
  $("transactionMonthLabel").textContent = `Bulan laporan: ${activeMonth}`;

  renderTargetMoneyStack(totalTabungan + totalDarurat + totalInvestasi);
}

function renderTargetMoneyStack(currentProgress) {
  const targetGoal = userProfile.targetAnnual || 20000000;
  let percentage = targetGoal > 0 ? (currentProgress / targetGoal) * 100 : 0;
  if (percentage < 0) percentage = 0;

  const displayPercentage = Math.round(percentage);

  $("targetCurrentAmount").textContent = formatMoney(currentProgress);
  $("targetGoalAmount").textContent = formatMoney(targetGoal);
  $("targetPercentageText").textContent = `${displayPercentage}%`;

  const trackBar = $("moneyTrackBar");
  trackBar.style.width = `${Math.min(100, percentage)}%`;

  const banner = $("congratulationsBanner");
  if (currentProgress >= targetGoal && targetGoal > 0) {
    banner.hidden = false;
    $("congratulationsText").textContent =
      `🥳 Selamat! Anda berhasil mencapai target tahun ini sebesar ${formatMoney(targetGoal)}!`;
  } else {
    banner.hidden = true;
  }
}

function renderAllocations() {
  const overview = $("allocations");
  const budget = $("budgetAllocations");
  overview.replaceChildren();
  budget.replaceChildren();

  for (const [category, label] of Object.entries(CATEGORIES)) {
    const percent = monthData().allocations[category];
    const amount = allocation(category);
    const spent = transactionTotal("expense", category);
    const remaining = balance(category);

    const card = document.createElement("article");
    card.className = "allocation-card";

    const heading = document.createElement("h3");
    heading.textContent = label;

    const value = document.createElement("p");
    value.className = "allocation-amount";
    value.textContent = formatMoney(amount);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${percent}% dari pendapatan utama`;

    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = Math.min(100, amount ? spent / amount * 100 : (spent ? 100 : 0));
    progress.setAttribute("aria-label", `Penggunaan anggaran ${label}`);

    const remainingText = document.createElement("p");
    remainingText.className = "muted small";
    remainingText.textContent = `Sisa bulan ini: ${formatMoney(remaining)}`;

    card.append(heading, value, detail, progress, remainingText);
    overview.appendChild(card);

    const row = document.createElement("div");
    row.className = "budget-row";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = label;
    const description = document.createElement("p");
    description.textContent = `Anggaran ${formatMoney(amount)}`;
    info.append(title, description);

    const inputLabel = document.createElement("label");
    inputLabel.textContent = "Persentase";
    const input = document.createElement("input");
    input.id = `budget-${category}`;
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.required = true;
    input.value = percent;
    inputLabel.appendChild(input);

    row.append(info, inputLabel);
    budget.appendChild(row);
  }
}

function buildTransactionRow(t) {
  const row = document.createElement("tr");
  const values = [
    t.date,
    t.note || CATEGORIES[t.category],
    CATEGORIES[t.category],
    `${t.type === "income" ? "+" : "−"}${formatMoney(t.amount)}`
  ];

  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  }

  const actionCell = document.createElement("td");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button secondary";
  remove.textContent = "Hapus";

  remove.addEventListener("click", async () => {
    if (!confirm("Hapus transaksi ini?")) return;

    const key = monthFromDate(t.date);
    months[key].transactions = months[key].transactions.filter(item => item.id !== t.id);
    const linkedWallet = wallets.find(w => w.id === t.walletId);
    if (linkedWallet) linkedWallet.balance += t.type === "income" ? -t.amount : t.amount;
    await saveState();
    renderAll();
    message("transactionMessage", "Transaksi dihapus.", "success");
  });

  actionCell.appendChild(remove);
  row.appendChild(actionCell);
  return row;
}

function renderTransactions() {
  const term = ($("transactionSearch")?.value || "").trim().toLowerCase();
  const sorted = [...monthData().transactions].filter(t =>
    !term || `${t.note || ""} ${CATEGORIES[t.category] || ""} ${t.date}`.toLowerCase().includes(term)
  ).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  $("transactions").replaceChildren();
  $("recentTransactions").replaceChildren();

  for (const t of sorted) $("transactions").appendChild(buildTransactionRow(t));
  for (const t of sorted.slice(0, 5)) $("recentTransactions").appendChild(buildTransactionRow(t));

  $("emptyState").hidden = sorted.length > 0;
  $("recentEmptyState").hidden = sorted.length > 0;
}

function renderChart() {
  const canvas = $("financeChart");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = Math.max(280, canvas.clientWidth);
  const height = window.innerWidth <= 560 ? 230 : 260;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const isDark = userProfile.theme === "dark";
  const green = isDark ? "#34a875" : "#247653";
  const red = isDark ? "#e56b6e" : "#cf6b67";
  const muted = isDark ? "#9aa8a0" : "#738078";
  const grid = isDark ? "#2d3d36" : "#e3e9e3";
  const income = monthData().income + transactionTotal("income");
  const expense = transactionTotal("expense");

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.strokeStyle = grid;

  if (chartMode === "overview") {
    const top = 24;
    const bottom = height - 38;
    const chartHeight = bottom - top;
    const max = Math.max(income, expense, 1);
    const barWidth = Math.min(64, width * .16);
    const gap = Math.min(38, width * .1);
    const center = width / 2;

    for (let i = 0; i <= 4; i++) {
      const y = top + chartHeight * i / 4;
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(width - 12, y);
      ctx.stroke();
    }

    [
      { label: "Pemasukan", value: income, color: green, x: center - barWidth - gap / 2 },
      { label: "Pengeluaran", value: expense, color: red, x: center + gap / 2 }
    ].forEach(bar => {
      const barHeight = bar.value / max * chartHeight;
      ctx.fillStyle = bar.color;
      ctx.fillRect(bar.x, bottom - barHeight, barWidth, barHeight);
      ctx.fillStyle = muted;
      ctx.textAlign = "center";
      ctx.fillText(bar.label, bar.x + barWidth / 2, height - 12);
    });
  } else {
    const categories = Object.entries(CATEGORIES).map(([key, label]) => ({
      label,
      value: transactionTotal("expense", key)
    }));
    const max = Math.max(...categories.map(item => item.value), 1);
    const rowHeight = Math.min(48, (height - 20) / categories.length);
    const barX = Math.min(120, width * .38);

    categories.forEach((item, i) => {
      const y = 12 + i * rowHeight;
      ctx.textAlign = "left";
      ctx.fillStyle = muted;
      ctx.fillText(item.label, 2, y + 11);

      const available = width - barX - 12;
      ctx.fillStyle = grid;
      ctx.fillRect(barX, y, available, 11);
      ctx.fillStyle = green;
      ctx.fillRect(barX, y, available * item.value / max, 11);

      ctx.textAlign = "right";
      ctx.fillStyle = muted;
      ctx.fillText(formatMoney(item.value), width - 2, y + 29);
    });
  }

  $("chartSummary").textContent =
    `${activeMonth} · Pemasukan ${formatMoney(income)} · Pengeluaran ${formatMoney(expense)}`;
  $("chartMessage").textContent = income === 0 && expense === 0
    ? "Belum ada aktivitas keuangan pada bulan ini."
    : "Grafik mengikuti bulan yang dipilih.";
}

function updateProfileUI(user) {
  const email = user ? user.email : "";
  const fallbackName = email.includes("@") ? email.split("@")[0] : "Akun saya";
  const name = userProfile.username || fallbackName;
  const initial = name.charAt(0).toUpperCase() || "U";

  $("profileName").textContent = name;
  $("profileMenuName").textContent = name;
  $("profileEmail").textContent = email;
  $("profileDetailsName").textContent = name;
  $("profileDetailsEmail").textContent = email;
  $("profileDetailsBio").textContent = userProfile.bio || "";

  $("editUsername").value = name;
  $("editBio").value = userProfile.bio || "";
  $("editTargetAnnual").value = userProfile.targetAnnual || 20000000;

  const avatars = [$("profileAvatar"), $("profileDetailsAvatar")];
  avatars.forEach(el => {
    if (userProfile.avatarUrl) {
      el.textContent = "";
      el.style.backgroundImage = `url(${userProfile.avatarUrl})`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    } else {
      el.style.backgroundImage = "none";
      el.textContent = initial;
    }
  });
}

function renderAll() {
  renderSummary();
  renderAllocations();
  renderTransactions();
  renderChart();
  renderFeatureViews();
  if (currentUser) updateProfileUI(currentUser);
}

function showPage(id) {
  const ids = ["dashboard", "transactionsView", "budgetView", "profileView", "walletsView", "calculatorView", "goalsView", "debtsView", "calendarView", "reportsView", "settingsView"];
  if (!ids.includes(id)) return;

  ids.forEach(pageId => $(pageId).hidden = pageId !== id);
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === id);
  });

  $("profileMenu").hidden = true;
  $("profileButton").setAttribute("aria-expanded", "false");
}

async function logout() {
  $("logoutButton").disabled = true;
  $("profileLogoutButton").disabled = true;
  message("profileMessage", "Sedang keluar...");

  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    message("profileMessage", "Gagal keluar. Periksa koneksi internet.", "error");
  } finally {
    $("logoutButton").disabled = false;
    $("profileLogoutButton").disabled = false;
  }
}

function wireThemeToggle() {
  const savedTheme = localStorage.getItem("ruangDanaTheme") || "light";
  applyTheme(savedTheme);

  $("themeToggleBtn").addEventListener("click", () => {
    const nextTheme = userProfile.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveState();
  });
}

function wireNavigation() {
  document.querySelectorAll("[data-view]").forEach(button =>
    button.addEventListener("click", () => showPage(button.dataset.view))
  );

  $("goToBudget").addEventListener("click", () => showPage("budgetView"));
  $("profileDetailsButton").addEventListener("click", () => showPage("profileView"));

  $("profileButton").addEventListener("click", () => {
    const menu = $("profileMenu");
    menu.hidden = !menu.hidden;
    $("profileButton").setAttribute("aria-expanded", String(!menu.hidden));
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".profile-area")) {
      $("profileMenu").hidden = true;
      $("profileButton").setAttribute("aria-expanded", "false");
    }
  });

  $("logoutButton").addEventListener("click", logout);
  $("profileLogoutButton").addEventListener("click", logout);

  $("monthPicker").addEventListener("change", () => {
    if (!/^\d{4}-\d{2}$/.test($("monthPicker").value)) return;
    activeMonth = $("monthPicker").value;
    monthData();
    renderAll();
  });

  $("transactionSearch")?.addEventListener("input", renderTransactions);

  $("chartMode").addEventListener("change", () => {
    chartMode = $("chartMode").value;
    renderChart();
  });

  window.addEventListener("resize", renderChart);
}

function wireProfileAndTarget() {
  $("profileForm").addEventListener("submit", async event => {
    event.preventDefault();

    const username = $("editUsername").value.trim();
    const bio = $("editBio").value.trim();
    const targetAnnual = Number($("editTargetAnnual").value);

    if (!username) {
      message("profileFormMessage", "Username tidak boleh kosong.", "error");
      return;
    }

    if (!Number.isSafeInteger(targetAnnual) || targetAnnual < 0) {
      message("profileFormMessage", "Target tahunan harus berupa nominal yang valid.", "error");
      return;
    }

    userProfile.username = username;
    userProfile.bio = bio;
    userProfile.targetAnnual = targetAnnual;

    await saveState();
    renderAll();
    message("profileFormMessage", "Profil dan target berhasil diperbarui!", "success");
  });

  // Fitur Ubah Kata Sandi (Password)
  $("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const currentPassword = $("currentPassword").value;
    const newPassword = $("newPassword").value;

    if (!currentUser || !currentUser.email) return;

    message("passwordMessage", "Memperbarui kata sandi...");

    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);

      message("passwordMessage", "Kata sandi berhasil diperbarui!", "success");
      $("passwordForm").reset();
    } catch (error) {
      console.error("Gagal ganti password:", error);
      let errMsg = "Gagal memperbarui kata sandi.";
      if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
        errMsg = "Kata sandi saat ini salah.";
      } else if (error.code === "auth/weak-password") {
        errMsg = "Kata sandi baru terlalu lemah (minimal 6 karakter).";
      }
      message("passwordMessage", errMsg, "error");
    }
  });

  $("avatarInput").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      message("profileFormMessage", "Pilih file gambar yang valid.", "error");
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      message("profileFormMessage", "Ukuran foto maksimal 3MB.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      userProfile.avatarUrl = reader.result;
      await saveState();
      renderAll();
      message("profileFormMessage", "Foto profil berhasil diganti!", "success");
    };
    reader.readAsDataURL(file);
  });
}

function wireBudget() {
  $("saveBudget").addEventListener("click", async () => {
    const income = Number($("budgetIncome").value);

    if (!Number.isSafeInteger(income) || income < 0) {
      message("budgetMessage", "Pendapatan harus berupa angka positif atau nol.", "error");
      return;
    }

    const allocations = {};
    for (const category of Object.keys(CATEGORIES)) {
      const value = Number($(`budget-${category}`).value);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        message("budgetMessage", "Persentase harus bilangan bulat dari 0 sampai 100.", "error");
        return;
      }
      allocations[category] = value;
    }

    const total = Object.values(allocations).reduce((a, b) => a + b, 0);
    if (total !== 100) {
      message("budgetMessage", `Total alokasi harus 100%. Total saat ini ${total}%.`, "error");
      return;
    }

    monthData().income = income;
    monthData().allocations = allocations;
    await saveState();
    renderAll();
    message("budgetMessage", `Anggaran ${activeMonth} berhasil disimpan.`, "success");
  });
}

function wireTransactions() {
  $("transactionForm").addEventListener("submit", async event => {
    event.preventDefault();

    const type = $("type").value;
    const category = $("category").value;
    const amount = Number($("amount").value);
    const date = $("date").value;
    const note = $("note").value.trim();

    if (!["income", "expense"].includes(type) || !CATEGORIES[category]) {
      message("transactionMessage", "Jenis atau kategori transaksi tidak valid.", "error");
      return;
    }

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      message("transactionMessage", "Masukkan nominal positif dalam rupiah.", "error");
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      message("transactionMessage", "Pilih tanggal transaksi yang valid.", "error");
      return;
    }

    const key = monthFromDate(date);
    const data = monthData(key);

    const walletId = $("transactionWallet")?.value || "";
    const selectedWallet = wallets.find(w => w.id === walletId);
    if (type === "expense" && selectedWallet && amount > selectedWallet.balance) {
      message("transactionMessage", `Saldo dompet tidak cukup. Sisa ${formatMoney(selectedWallet.balance)}.`, "error");
      return;
    }

    if (type === "expense" && amount > balance(category, key)) {
      message("transactionMessage",
        `Saldo ${CATEGORIES[category]} bulan ${key} tidak cukup. Sisa ${formatMoney(balance(category, key))}.`,
        "error");
      return;
    }

    data.transactions.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type, category, amount, date, note: note.slice(0, 120), walletId
    });
    if (selectedWallet) selectedWallet.balance += type === "income" ? amount : -amount;

    activeMonth = key;
    $("monthPicker").value = key;

    await saveState();
    renderAll();
    $("transactionForm").reset();
    $("date").value = today();
    message("transactionMessage", "Transaksi berhasil disimpan.", "success");
  });
}


function makeFeatureCard(title, detail, amountText = "", actions = []) {
  const card = document.createElement("article");
  card.className = "feature-card";
  const heading = document.createElement("h3"); heading.textContent = title;
  const desc = document.createElement("p"); desc.textContent = detail;
  card.append(heading, desc);
  if (amountText) { const amount = document.createElement("strong"); amount.textContent = amountText; card.append(amount); }
  if (actions.length) {
    const row = document.createElement("div"); row.className = "button-row";
    actions.forEach(({ label, action, danger }) => {
      const button = document.createElement("button"); button.type = "button";
      button.className = danger ? "button danger-button" : "button secondary";
      button.textContent = label; button.addEventListener("click", action); row.append(button);
    });
    card.append(row);
  }
  return card;
}

function monthIncome(key) {
  const d = months[key] || { income: 0, transactions: [] };
  return d.income + d.transactions.filter(t => t.type === "income").reduce((s,t)=>s+t.amount,0);
}
function monthExpense(key) {
  const d = months[key] || { transactions: [] };
  return d.transactions.filter(t => t.type === "expense").reduce((s,t)=>s+t.amount,0);
}
function renderFeatureViews() {
  const walletSelect = $("transactionWallet");
  if (walletSelect) {
    const selected = walletSelect.value;
    walletSelect.replaceChildren();
    const none = document.createElement("option"); none.value = ""; none.textContent = "Tidak ditautkan"; walletSelect.append(none);
    wallets.forEach(w => { const option=document.createElement("option");option.value=w.id;option.textContent=`${w.name} (${formatMoney(w.balance)})`;walletSelect.append(option); });
    if (wallets.some(w=>w.id===selected)) walletSelect.value=selected;
  }
  // Wallets
  const walletList = $("walletList");
  if (walletList) {
    walletList.replaceChildren();
    wallets.forEach(w => walletList.append(makeFeatureCard(w.name, w.type, formatMoney(w.balance), [
      { label: "Hapus", danger: true, action: async () => {
        if (!confirm(`Hapus dompet "${w.name}"?`)) return;
        wallets = wallets.filter(x => x.id !== w.id); await saveState(); renderFeatureViews();
      }}
    ])));
    $("walletEmpty").hidden = wallets.length > 0;
  }
  // Goals
  const goalList = $("goalList");
  if (goalList) {
    goalList.replaceChildren();
    goals.forEach(g => {
      const pct = g.target > 0 ? Math.min(100, Math.round(g.current / g.target * 100)) : 0;
      const remaining = Math.max(0, g.target - g.current);
      const days = Math.max(0, Math.ceil((new Date(`${g.date}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000));
      const monthsLeft = Math.max(1, Math.ceil(days / 30));
      const monthly = Math.ceil(remaining / monthsLeft);
      goalList.append(makeFeatureCard(g.name, `Target ${g.date} · ${pct}% tercapai · Perlu sekitar ${formatMoney(monthly)}/bulan`, `${formatMoney(g.current)} dari ${formatMoney(g.target)}`, [
        { label: "+ Tambah tabungan", action: async () => {
          const raw = prompt("Berapa nominal yang ingin ditambahkan (Rp)?");
          if (raw === null) return;
          const value = Number(raw);
          if (!Number.isSafeInteger(value) || value <= 0) return alert("Masukkan nominal rupiah yang valid.");
          g.current = Math.min(g.target, g.current + value); await saveState(); renderFeatureViews();
        }},
        { label: "Hapus", danger: true, action: async () => {
          if (!confirm(`Hapus target "${g.name}"?`)) return;
          goals = goals.filter(x => x.id !== g.id); await saveState(); renderFeatureViews();
        }}
      ]));
    });
    $("goalEmpty").hidden = goals.length > 0;
  }
  // Debts and due reminders
  const debtList = $("debtList");
  if (debtList) {
    debtList.replaceChildren();
    debts.forEach(d => debtList.append(makeFeatureCard(
      `${d.type === "payable" ? "Utang" : "Piutang"} · ${d.name}`,
      `Jatuh tempo: ${d.due || "Belum ditentukan"} · Status: ${d.paid ? "Lunas" : "Belum lunas"}`,
      formatMoney(d.amount),
      [
        { label: d.paid ? "Tandai belum lunas" : "Tandai lunas", action: async () => {
          d.paid = !d.paid; await saveState(); renderFeatureViews();
        }},
        { label: "Hapus", danger: true, action: async () => {
          if (!confirm("Hapus catatan ini?")) return;
          debts = debts.filter(x => x.id !== d.id); await saveState(); renderFeatureViews();
        }}
      ]
    )));
    $("debtEmpty").hidden = debts.length > 0;
  }
  const reminderList = $("dueReminders");
  if (reminderList) {
    reminderList.replaceChildren();
    const upcoming = debts.filter(d => !d.paid && d.due).sort((a,b)=>a.due.localeCompare(b.due));
    upcoming.forEach(d => {
      const row=document.createElement("div");row.className="activity-item";
      const left=document.createElement("div");left.textContent=`${d.type==="payable"?"Utang":"Piutang"} · ${d.name}`;
      const meta=document.createElement("small");meta.textContent=`Jatuh tempo ${d.due}`;left.append(meta);
      const right=document.createElement("strong");right.textContent=formatMoney(d.amount);
      row.append(left,right);reminderList.append(row);
    });
    $("reminderEmpty").hidden=upcoming.length>0;
  }
  // Reports and basic financial health assessment
  const income = monthIncome(activeMonth), expense = monthExpense(activeMonth), net = income - expense;
  const savingsRate = income > 0 ? Math.round(Math.max(0, net) / income * 100) : 0;
  if ($("reportIncome")) {
    $("reportIncome").textContent = formatMoney(income);
    $("reportExpense").textContent = formatMoney(expense);
    $("reportNet").textContent = formatMoney(net);
    $("reportSavingRate").textContent = `${savingsRate}%`;
    const status = $("healthStatus"), insights = $("healthInsights");
    insights.replaceChildren();
    if (income === 0 && expense === 0) {
      status.textContent = "Belum cukup data untuk menilai kondisi bulan ini.";
      ["Catat pemasukan dan pengeluaran secara konsisten.", "Analisis akan lebih bermakna setelah beberapa transaksi tercatat."].forEach(t=>{const li=document.createElement("li");li.textContent=t;insights.append(li);});
    } else {
      status.textContent = net < 0 ? "Perlu perhatian: pengeluaran lebih besar daripada pemasukan." : savingsRate >= 20 ? "Arus kas positif dengan rasio sisa uang yang baik." : "Arus kas positif, tetapi ruang untuk menabung masih dapat ditingkatkan.";
      const tips = [
        `Sisa arus kas bulan ini ${formatMoney(net)}.`,
        `Rasio sisa uang terhadap pemasukan sekitar ${savingsRate}%.`,
        expense > income * .8 ? "Pengeluaran sudah melebihi 80% pemasukan; periksa kembali kategori belanja." : "Jaga pengeluaran agar tetap sesuai rencana anggaran.",
        debts.some(d=>!d.paid && d.due && d.due <= today()) ? "Ada utang atau piutang belum lunas yang tanggalnya sudah tiba atau lewat." : "Periksa tanggal jatuh tempo kewajiban secara berkala."
      ];
      tips.forEach(t=>{const li=document.createElement("li");li.textContent=t;insights.append(li);});
    }
    const trend = $("monthlyTrend"); trend.replaceChildren();
    const keys = [];
    const cursor = new Date(`${activeMonth}-01T00:00:00`);
    for (let i=5;i>=0;i--) { const d=new Date(cursor.getFullYear(),cursor.getMonth()-i,1); keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
    const max = Math.max(1,...keys.flatMap(k=>[monthIncome(k),monthExpense(k)]));
    keys.forEach(k=>{
      const row=document.createElement("div");row.className="trend-row";
      const label=document.createElement("strong");label.textContent=k.slice(5);
      const inc=document.createElement("div");inc.innerHTML=`<small>Masuk ${formatMoney(monthIncome(k))}</small><div class="trend-track"><div class="trend-fill" style="width:${monthIncome(k)/max*100}%"></div></div>`;
      const exp=document.createElement("div");exp.innerHTML=`<small>Keluar ${formatMoney(monthExpense(k))}</small><div class="trend-track"><div class="trend-fill" style="width:${monthExpense(k)/max*100}%;background:var(--danger)"></div></div>`;
      row.append(label,inc,exp);trend.append(row);
    });
  }
  renderCalendar();
}

function renderCalendar() {
  const grid=$("calendarGrid"); if(!grid) return;
  const month=$("calendarMonth").value || activeMonth;
  const [year,monthNum]=month.split("-").map(Number);
  const first=new Date(year,monthNum-1,1), count=new Date(year,monthNum,0).getDate();
  grid.replaceChildren();
  ["Min","Sen","Sel","Rab","Kam","Jum","Sab"].forEach(d=>{const el=document.createElement("div");el.className="calendar-weekday";el.textContent=d;grid.append(el);});
  for(let i=0;i<first.getDay();i++){const blank=document.createElement("div");grid.append(blank);}
  const entries=Object.values(months).flatMap(m=>m.transactions).filter(t=>t.date.startsWith(month));
  for(let day=1;day<=count;day++){
    const date=`${month}-${String(day).padStart(2,"0")}`;
    const events=entries.filter(t=>t.date===date);
    const cell=document.createElement("div");cell.className=`calendar-day ${events.length?"has-event":""}`;
    const number=document.createElement("strong");number.textContent=day;cell.append(number);
    if(events.length){const small=document.createElement("small");small.textContent=`${events.length} transaksi`;cell.append(small);}
    grid.append(cell);
  }
  const list=$("calendarEvents");list.replaceChildren();
  const sorted=entries.sort((a,b)=>a.date.localeCompare(b.date));
  sorted.forEach(t=>{
    const row=document.createElement("div");row.className="activity-item";
    const left=document.createElement("div");left.textContent=t.note||CATEGORIES[t.category];const meta=document.createElement("small");meta.textContent=`${t.date} · ${CATEGORIES[t.category]}`;left.append(meta);
    const right=document.createElement("strong");right.textContent=`${t.type==="income"?"+":"−"}${formatMoney(t.amount)}`;right.className=t.type==="income"?"":"danger-text";
    row.append(left,right);list.append(row);
  });
  $("calendarEmpty").hidden=sorted.length>0;
}

function wireExtraFeatures() {
  $("walletForm").addEventListener("submit",async e=>{
    e.preventDefault();const name=$("walletName").value.trim(),balanceValue=Number($("walletBalance").value);
    if(!name||!Number.isSafeInteger(balanceValue)||balanceValue<0){message("walletMessage","Nama dan saldo dompet harus valid.","error");return;}
    wallets.push({id:crypto.randomUUID(),name,type:$("walletType").value,balance:balanceValue});
    await saveState();$("walletForm").reset();$("walletBalance").value=0;renderFeatureViews();message("walletMessage","Dompet berhasil ditambahkan.","success");
  });
  $("goalForm").addEventListener("submit",async e=>{
    e.preventDefault();const target=Number($("goalAmount").value),current=Number($("goalCurrent").value),date=$("goalDate").value,name=$("goalName").value.trim();
    if(!name||!Number.isSafeInteger(target)||target<=0||!Number.isSafeInteger(current)||current<0||!date){message("goalMessage","Periksa kembali data target.","error");return;}
    goals.push({id:crypto.randomUUID(),name,target,current:Math.min(current,target),date});
    await saveState();$("goalForm").reset();renderFeatureViews();message("goalMessage","Target berhasil disimpan.","success");
  });
  $("debtForm").addEventListener("submit",async e=>{
    e.preventDefault();const amount=Number($("debtAmount").value),name=$("debtName").value.trim();
    if(!name||!Number.isSafeInteger(amount)||amount<=0){message("debtMessage","Nama dan nominal harus valid.","error");return;}
    debts.push({id:crypto.randomUUID(),type:$("debtType").value,name,amount,due:$("debtDue").value,paid:false});
    await saveState();$("debtForm").reset();renderFeatureViews();message("debtMessage","Catatan berhasil ditambahkan.","success");
  });
  const calculate=()=>{
    const income=Number($("calcIncome").value)||0,expense=Number($("calcExpense").value)||0;
    $("calcResult").textContent=formatMoney(income-expense);
    const amount=Number($("splitAmount").value)||0;
    const parts=[["Tabungan",Number($("splitSaving").value)],["Kebutuhan",Number($("splitNeeds").value)],["Keinginan",Number($("splitWants").value)]];
    const total=parts.reduce((s,p)=>s+p[1],0);
    $("splitValidation").textContent=`Total pembagian: ${total}% ${total===100?"✓":"— harus 100%"}`;
    $("splitValidation").className=total===100?"message success":"message error";
    $("splitResults").replaceChildren();
    parts.forEach(([label,pct])=>{const row=document.createElement("div");row.className="split-result";const a=document.createElement("span");a.textContent=`${label} (${pct}%)`;const b=document.createElement("strong");b.textContent=formatMoney(Math.round(amount*pct/100));row.append(a,b);$("splitResults").append(row);});
  };
  ["calcIncome","calcExpense","splitAmount","splitSaving","splitNeeds","splitWants"].forEach(id=>$(id).addEventListener("input",calculate));
  calculate();
  const simulate=()=>{
    const target=Number($("simTarget").value),current=Number($("simCurrent").value),monthly=Number($("simMonthly").value);
    if(target<=current){$("simResult").textContent="Target tercapai";return;}
    if(monthly<=0){$("simResult").textContent="Masukkan setoran bulanan";return;}
    $("simResult").textContent=`${Math.ceil((target-current)/monthly)} bulan`;
  };
  ["simTarget","simCurrent","simMonthly"].forEach(id=>$(id).addEventListener("input",simulate));simulate();
  $("calendarMonth").value=activeMonth;
  $("calendarMonth").addEventListener("change",renderCalendar);
  $("backupButton").addEventListener("click",()=>{
    const data={version:2,exportedAt:new Date().toISOString(),months,profile:userProfile,wallets,debts,goals,reminders};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`ruang-dana-backup-${today()}.json`;a.click();URL.revokeObjectURL(url);
    message("backupMessage","Backup JSON berhasil dibuat.","success");
  });
  $("printReportButton").addEventListener("click",()=>{showPage("reportsView");window.print();});
  $("exportCsvButton").addEventListener("click",()=>{
    const all=Object.values(months).flatMap(m=>m.transactions);
    const rows=[["Tanggal","Jenis","Kategori","Keterangan","Nominal","Dompet"],...all.map(t=>[t.date,t.type,CATEGORIES[t.category],t.note||"",t.amount,wallets.find(w=>w.id===t.walletId)?.name||""])];
    const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`ruang-dana-transaksi-${today()}.csv`;a.click();URL.revokeObjectURL(url);
    message("backupMessage","Ekspor CSV berhasil dibuat.","success");
  });
  $("restoreInput").addEventListener("change",async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      const data=JSON.parse(await file.text());
      if(!data||typeof data!=="object"||!data.months||typeof data.months!=="object")throw new Error("Format backup tidak dikenali.");
      const restoredMonths=cleanMonths(data.months);
      if(!confirm("Pulihkan backup? Data cloud saat ini akan digantikan dengan isi file backup."))return;
      months=restoredMonths;userProfile={...DEFAULT_USER_PROFILE,...(data.profile||{})};
      wallets=Array.isArray(data.wallets)?data.wallets:[];debts=Array.isArray(data.debts)?data.debts:[];
      goals=Array.isArray(data.goals)?data.goals:[];reminders=Array.isArray(data.reminders)?data.reminders:[];
      if(!months[activeMonth])months[activeMonth]=cloneDefault();
      await saveState();renderAll();message("backupMessage","Backup berhasil dipulihkan.","success");
    }catch(err){console.error(err);message("backupMessage",`Gagal memulihkan backup: ${err.message}`,"error");}
    finally{e.target.value="";}
  });
}

function wireAuth() {
  $("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (authBusy) return;

    authBusy = true;
    $("authSubmit").disabled = true;
    message("authMessage", "Memproses akun...");

    try {
      const email = $("authEmail").value.trim();
      const password = $("authPassword").value;

      if (signupMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      console.error("Auth error:", error);
      const errors = {
        "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
        "auth/invalid-email": "Format email tidak valid.",
        "auth/weak-password": "Kata sandi minimal 6 karakter.",
        "auth/invalid-credential": "Email atau kata sandi salah.",
        "auth/user-not-found": "Akun tidak ditemukan.",
        "auth/wrong-password": "Kata sandi salah.",
        "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
        "auth/network-request-failed": "Koneksi internet bermasalah.",
        "auth/operation-not-allowed": "Aktifkan Email/Password di Firebase Authentication."
      };
      message("authMessage", errors[error.code] || `Gagal login (${error.code || "kesalahan"}).`, "error");
    } finally {
      authBusy = false;
      $("authSubmit").disabled = false;
    }
  });

  $("googleSignInBtn").addEventListener("click", async () => {
    if (authBusy) return;
    authBusy = true;
    $("googleSignInBtn").disabled = true;
    message("authMessage", "Menghubungkan ke Google...");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google sign-in error:", error);
      const errors = {
        "auth/popup-closed-by-user": "Jendela login ditutup sebelum selesai.",
        "auth/popup-blocked": "Popup diblokir browser. Izinkan popup lalu coba lagi.",
        "auth/unauthorized-domain": "Domain website belum diizinkan di Firebase Authentication.",
        "auth/operation-not-allowed": "Aktifkan penyedia Google di Firebase Authentication.",
        "auth/account-exists-with-different-credential": "Email ini sudah digunakan dengan metode login lain. Masuk dengan metode lama terlebih dahulu."
      };
      message("authMessage", errors[error.code] || `Login Google gagal (${error.code || "kesalahan"}).`, "error");
    } finally {
      authBusy = false;
      $("googleSignInBtn").disabled = false;
    }
  });

  $("toggleAuthMode").addEventListener("click", () => {
    signupMode = !signupMode;
    $("authTitle").textContent = signupMode ? "Buat akun baru" : "Selamat datang";
    $("authSubtitle").textContent = signupMode
      ? "Daftar untuk mulai mengatur keuanganmu."
      : "Masuk untuk melihat keuanganmu.";
    $("authSubmit").textContent = signupMode ? "Buat akun" : "Masuk";
    $("authSwitchText").textContent = signupMode ? "Sudah punya akun?" : "Belum punya akun?";
    $("toggleAuthMode").textContent = signupMode ? "Masuk" : "Buat akun";
    $("authPassword").autocomplete = signupMode ? "new-password" : "current-password";
    message("authMessage", "");
  });
}

async function connectUser(user) {
  if (unsubscribeData) unsubscribeData();
  unsubscribeData = null;
  currentUser = user;
  dataReady = false;

  $("authView").hidden = true;
  $("appView").hidden = false;
  showPage("dashboard");
  $("monthPicker").value = activeMonth;

  const ref = doc(db, "users", user.uid, "appData", "main");

  try {
    const snapshot = await getDoc(ref);
    if (currentUser?.uid !== user.uid) return;

    if (!snapshot.exists()) {
      months = { [activeMonth]: cloneDefault() };
      userProfile = { ...DEFAULT_USER_PROFILE };
      wallets = []; debts = []; goals = []; reminders = [];
      await setDoc(ref, { months, profile: userProfile, wallets, debts, goals, reminders });
    } else {
      const cloud = snapshot.data();
      months = cloud.months ? cleanMonths(cloud.months) : {};
      if (!months[activeMonth]) months[activeMonth] = cloneDefault();

      if (cloud.profile) {
        userProfile = { ...DEFAULT_USER_PROFILE, ...cloud.profile };
      }
      wallets = Array.isArray(cloud.wallets) ? cloud.wallets : [];
      debts = Array.isArray(cloud.debts) ? cloud.debts : [];
      goals = Array.isArray(cloud.goals) ? cloud.goals : [];
      reminders = Array.isArray(cloud.reminders) ? cloud.reminders : [];
      if (userProfile.theme) {
        applyTheme(userProfile.theme);
      }
    }

    if (currentUser?.uid !== user.uid) return;
    dataReady = true;
    renderAll();

    unsubscribeData = onSnapshot(ref, remote => {
      if (!remote.exists() || !currentUser || currentUser.uid !== user.uid) return;

      try {
        const cloud = remote.data();
        months = cloud.months ? cleanMonths(cloud.months) : {};
        if (!months[activeMonth]) months[activeMonth] = cloneDefault();

        if (cloud.profile) {
          userProfile = { ...DEFAULT_USER_PROFILE, ...cloud.profile };
          applyTheme(userProfile.theme);
        }
        wallets = Array.isArray(cloud.wallets) ? cloud.wallets : [];
        debts = Array.isArray(cloud.debts) ? cloud.debts : [];
        goals = Array.isArray(cloud.goals) ? cloud.goals : [];
        reminders = Array.isArray(cloud.reminders) ? cloud.reminders : [];

        renderAll();
      } catch (error) {
        console.error("Data cloud tidak valid:", error);
      }
    });
  } catch (error) {
    console.error("Gagal memuat data:", error);
    $("appView").hidden = true;
    $("authView").hidden = false;
    message("authMessage", "Tidak dapat memuat data dari Firestore.", "error");
    await signOut(auth).catch(() => {});
  }
}

function disconnectUser() {
  if (unsubscribeData) unsubscribeData();
  unsubscribeData = null;
  currentUser = null;
  dataReady = false;
  months = { [activeMonth]: cloneDefault() };
  wallets = []; debts = []; goals = []; reminders = [];
  userProfile = { ...DEFAULT_USER_PROFILE };
  $("authForm").reset();
  $("profileMenu").hidden = true;
  $("profileButton").setAttribute("aria-expanded", "false");
  $("authView").hidden = false;
  $("appView").hidden = true;
  message("authMessage", "");
}

$("monthPicker").value = activeMonth;
$("date").value = today();

wireThemeToggle();
wireAuth();
wireNavigation();
wireProfileAndTarget();
wireBudget();
wireTransactions();
wireExtraFeatures();

onAuthStateChanged(auth, user => {
  if (user) {
    connectUser(user);
  } else {
    disconnectUser();
  }
});

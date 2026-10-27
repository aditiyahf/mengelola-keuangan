
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ========================================
// 1. KONFIGURASI DAN DATA AWAL
// ========================================

const STORAGE_KEY = "ruangDanaDataV1";

const DEFAULTS = {
  income: 2000000,
  allocations: {
    investasi: 20,
    tabungan: 20,
    darurat: 10,
    bebas: 50
  },
  transactions: []
};

const CATEGORIES = {
  investasi: "Investasi",
  tabungan: "Tabungan",
  darurat: "Dana darurat",
  bebas: "Uang bebas pakai"
};

const $ = id => document.getElementById(id);

const rupiah = amount =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(amount);

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function cleanState(data) {
  if (
    !data ||
    typeof data !== "object" ||
    !data.allocations ||
    !Array.isArray(data.transactions)
  ) {
    throw new Error("Format data tidak valid.");
  }

  const income = Number(data.income);

  if (!Number.isSafeInteger(income) || income < 0) {
    throw new Error("Pendapatan tidak valid.");
  }

  const allocations = {};

  for (const category of Object.keys(CATEGORIES)) {
    const value = Number(data.allocations[category]);

    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new Error("Persentase alokasi tidak valid.");
    }

    allocations[category] = value;
  }

  if (
    Object.values(allocations).reduce((a, b) => a + b, 0) !== 100
  ) {
    throw new Error("Total alokasi harus 100%.");
  }

  const transactions = data.transactions.map(transaction => {
    if (
      !transaction ||
      typeof transaction.id !== "string" ||
      !["income", "expense"].includes(transaction.type) ||
      !CATEGORIES[transaction.category] ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount <= 0 ||
      typeof transaction.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)
    ) {
      throw new Error("Ada transaksi dengan format tidak valid.");
    }

    return {
      id: transaction.id,
      type: transaction.type,
      category: transaction.category,
      amount: transaction.amount,
      date: transaction.date,
      note: String(transaction.note || "").slice(0, 120)
    };
  });

  return { income, allocations, transactions };
}

function loadLocalState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? cleanState(JSON.parse(saved)) : cloneDefaults();
  } catch {
    return cloneDefaults();
  }
}

let state = loadLocalState();
let currentUser = null;
let dataReady = false;
let unsubscribeData = null;
let signupMode = false;
let saveQueue = Promise.resolve();
let authRequestRunning = false;
let applyingCloudData = false;

// ========================================
// 2. PESAN DAN TAMPILAN LOGIN
// ========================================

function setMessage(id, message, kind = "") {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.className = `message ${kind}`;
}

function showApp(signedIn) {
  const main = document.querySelector("main.container");
  const authSection = $("authSection");

  if (!main || !authSection) return;

  authSection.hidden = signedIn;

  for (const child of main.children) {
    if (child !== authSection) {
      child.hidden = !signedIn;
    }
  }

  if ($("logoutButton")) {
    $("logoutButton").hidden = !signedIn;
  }

  const privacy = document.querySelector(".privacy");

  if (privacy) {
    privacy.textContent = signedIn
      ? "Data tersinkron melalui akun Firebase"
      : "Masuk untuk menyimpan data secara online";
  }
}

// ========================================
// 3. PERHITUNGAN KEUANGAN
// ========================================

function allocated(category) {
  return Math.round(
    state.income * state.allocations[category] / 100
  );
}

function totalFor(category, type) {
  return state.transactions
    .filter(t => t.category === category && t.type === type)
    .reduce((sum, t) => sum + t.amount, 0);
}

function balance(category) {
  return allocated(category)
    + totalFor(category, "income")
    - totalFor(category, "expense");
}

function totalTransactionIncome() {
  return state.transactions
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
}

function totalExpenses() {
  return state.transactions
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
}

// ========================================
// 4. SIMPAN DATA LOKAL DAN CLOUD
// ========================================

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Gagal menyimpan lokal:", error);
  }

  if (!currentUser || !dataReady || applyingCloudData) return;

  const userDoc = doc(
    db,
    "users",
    currentUser.uid,
    "appData",
    "main"
  );

  const snapshot = JSON.parse(JSON.stringify(state));

  saveQueue = saveQueue
    .catch(() => {})
    .then(() => setDoc(userDoc, snapshot))
    .catch(error => {
      console.error("Gagal menyimpan ke Firestore:", error);

      setMessage(
        "transactionMessage",
        "Data lokal tersimpan, tetapi sinkronisasi cloud gagal. Periksa koneksi dan aturan Firestore.",
        "error"
      );
    });
}

// ========================================
// 5. RENDER ALOKASI ANGGARAN
// ========================================

function renderAllocations() {
  const container = $("allocations");
  if (!container) return;

  container.innerHTML = "";

  for (const category of Object.keys(CATEGORIES)) {
    const card = document.createElement("article");
    card.className = "allocation-card";

    const heading = document.createElement("h3");
    heading.textContent = CATEGORIES[category];

    const amount = document.createElement("p");
    amount.textContent = rupiah(allocated(category));

    const label = document.createElement("label");
    label.textContent = "Persentase (%) ";

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = state.allocations[category];
    input.id = `allocation-${category}`;
    input.setAttribute(
      "aria-label",
      `Persentase ${CATEGORIES[category]}`
    );

    label.appendChild(input);

    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = state.allocations[category];
    progress.setAttribute(
      "aria-label",
      `Alokasi ${CATEGORIES[category]}`
    );

    const remaining = document.createElement("p");
    remaining.className = "muted";
    remaining.textContent = `Sisa kategori: ${rupiah(balance(category))}`;

    card.append(heading, amount, label, progress, remaining);
    container.appendChild(card);
  }
}

// ========================================
// 6. RENDER RINGKASAN
// ========================================

function renderSummary() {
  const totalIncome = state.income + totalTransactionIncome();
  const expenses = totalExpenses();
  const freeBudget = allocated("bebas");
  const freeSpent = totalFor("bebas", "expense");

  const values = {
    totalIncome: rupiah(totalIncome),
    totalSpent: rupiah(expenses),
    freeRemaining: rupiah(balance("bebas")),
    freeUsed: `${freeBudget > 0
      ? Math.round(freeSpent / freeBudget * 100)
      : freeSpent > 0 ? 100 : 0}%`
  };

  for (const [id, value] of Object.entries(values)) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  const incomeInput = $("income");

  if (incomeInput && document.activeElement !== incomeInput) {
    incomeInput.value = state.income;
  }
}

// ========================================
// 7. RENDER RIWAYAT TRANSAKSI
// ========================================

function renderTransactions() {
  const tbody = $("transactions");
  const emptyState = $("emptyState");

  if (!tbody) return;

  tbody.innerHTML = "";

  const sorted = [...state.transactions].sort((a, b) =>
    b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
  );

  if (emptyState) {
    emptyState.hidden = sorted.length > 0;
  }

  for (const transaction of sorted) {
    const row = document.createElement("tr");

    const dateCell = document.createElement("td");
    dateCell.textContent = transaction.date;

    const noteCell = document.createElement("td");
    noteCell.textContent =
      transaction.note || CATEGORIES[transaction.category];

    const categoryCell = document.createElement("td");
    categoryCell.textContent = CATEGORIES[transaction.category];

    const amountCell = document.createElement("td");
    amountCell.textContent =
      `${transaction.type === "income" ? "+" : "−"}${rupiah(transaction.amount)}`;

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");

    deleteButton.type = "button";
    deleteButton.className = "button secondary";
    deleteButton.textContent = "Hapus";

    deleteButton.addEventListener("click", () => {
      if (!confirm("Hapus transaksi ini?")) return;

      state.transactions = state.transactions.filter(
        item => item.id !== transaction.id
      );

      saveState();
      render();

      setMessage(
        "transactionMessage",
        "Transaksi berhasil dihapus.",
        "success"
      );
    });

    actionCell.appendChild(deleteButton);

    row.append(
      dateCell,
      noteCell,
      categoryCell,
      amountCell,
      actionCell
    );

    tbody.appendChild(row);
  }
}

function render() {
  renderSummary();
  renderAllocations();
  renderTransactions();
}

// ========================================
// 8. SIMPAN PENDAPATAN DAN ALOKASI
// ========================================

function wireBudget() {
  const incomeInput = $("income");
  const saveBudget = $("saveBudget");

  if (incomeInput) {
    incomeInput.addEventListener("change", () => {
      const income = Number(incomeInput.value);

      if (!Number.isSafeInteger(income) || income < 0) {
        setMessage(
          "allocationMessage",
          "Masukkan pendapatan berupa angka positif atau nol.",
          "error"
        );

        renderSummary();
        return;
      }

      state.income = income;
      saveState();
      render();

      setMessage(
        "allocationMessage",
        "Pendapatan berhasil diperbarui.",
        "success"
      );
    });
  }

  if (saveBudget) {
    saveBudget.addEventListener("click", () => {
      const allocations = {};

      for (const category of Object.keys(CATEGORIES)) {
        const input = $(`allocation-${category}`);
        const value = Number(input?.value);

        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value > 100
        ) {
          setMessage(
            "allocationMessage",
            "Setiap alokasi harus berupa bilangan bulat dari 0 sampai 100.",
            "error"
          );
          return;
        }

        allocations[category] = value;
      }

      const total = Object.values(allocations)
        .reduce((sum, value) => sum + value, 0);

      if (total !== 100) {
        setMessage(
          "allocationMessage",
          `Total alokasi harus 100%. Saat ini ${total}%.`,
          "error"
        );
        return;
      }

      state.allocations = allocations;

      saveState();
      render();

      setMessage(
        "allocationMessage",
        "Alokasi anggaran berhasil disimpan.",
        "success"
      );
    });
  }
}

// ========================================
// 9. TAMBAH TRANSAKSI
// ========================================

function wireTransactions() {
  const form = $("transactionForm");
  if (!form) return;

  form.addEventListener("submit", event => {
    event.preventDefault();

    const type = $("type")?.value;
    const category = $("category")?.value;
    const amount = Number($("amount")?.value);
    const date = $("date")?.value;
    const note = $("note")?.value.trim() || "";

    if (!["income", "expense"].includes(type)) {
      setMessage("transactionMessage", "Jenis transaksi tidak valid.", "error");
      return;
    }

    if (!CATEGORIES[category]) {
      setMessage("transactionMessage", "Kategori tidak valid.", "error");
      return;
    }

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setMessage("transactionMessage", "Nominal harus berupa angka positif.", "error");
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMessage("transactionMessage", "Pilih tanggal transaksi.", "error");
      return;
    }

    if (type === "expense" && amount > balance(category)) {
      setMessage(
        "transactionMessage",
        `Saldo ${CATEGORIES[category]} tidak mencukupi. Sisa saat ini ${rupiah(balance(category))}.`,
        "error"
      );
      return;
    }

    state.transactions.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      type,
      category,
      amount,
      date,
      note: note.slice(0, 120)
    });

    saveState();
    render();
    form.reset();

    const dateInput = $("date");
    if (dateInput) {
      dateInput.value = new Date().toLocaleDateString("en-CA");
    }

    setMessage(
      "transactionMessage",
      "Transaksi berhasil ditambahkan.",
      "success"
    );
  });
}

// ========================================
// 10. EKSPOR DAN IMPOR CADANGAN
// ========================================

function wireBackup() {
  const exportButton = $("exportData");
  const importInput = $("importData");

  if (exportButton) {
    exportButton.addEventListener("click", () => {
      const blob = new Blob(
        [JSON.stringify(state, null, 2)],
        { type: "application/json" }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "ruang-dana-backup.json";
      link.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMessage(
        "backupMessage",
        "File cadangan sudah disiapkan.",
        "success"
      );
    });
  }

  if (importInput) {
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = cleanState(JSON.parse(text));

        if (!confirm("Impor akan mengganti data akun saat ini. Lanjutkan?")) {
          return;
        }

        state = imported;
        saveState();
        render();

        setMessage(
          "backupMessage",
          "Data berhasil diimpor.",
          "success"
        );
      } catch (error) {
        console.error("Gagal mengimpor:", error);

        setMessage(
          "backupMessage",
          "File cadangan tidak valid atau tidak dapat dibaca.",
          "error"
        );
      } finally {
        importInput.value = "";
      }
    });
  }
}

// ========================================
// 11. LOGIN, DAFTAR, DAN LOGOUT
// ========================================

function wireAuth() {
  const form = $("authForm");
  const toggleButton = $("toggleAuthMode");
  const logoutButton = $("logoutButton");

  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (authRequestRunning) return;

      const email = $("authEmail")?.value.trim();
      const password = $("authPassword")?.value;
      const submitButton = $("authSubmit");

      if (!email || !password) {
        setMessage("authMessage", "Isi email dan kata sandi.", "error");
        return;
      }

      authRequestRunning = true;
      if (submitButton) submitButton.disabled = true;

      setMessage("authMessage", "Memproses akun...");

      try {
        if (signupMode) {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
      } catch (error) {
        console.error("Autentikasi gagal:", error);

        const messages = {
          "auth/email-already-in-use": "Email sudah terdaftar. Silakan login.",
          "auth/invalid-email": "Format email tidak valid.",
          "auth/weak-password": "Kata sandi minimal 6 karakter.",
          "auth/invalid-credential": "Email atau kata sandi salah.",
          "auth/user-not-found": "Akun tidak ditemukan. Silakan daftar.",
          "auth/wrong-password": "Kata sandi salah.",
          "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
          "auth/network-request-failed": "Periksa koneksi internet.",
          "auth/operation-not-allowed": "Aktifkan Email/Password di Firebase Authentication."
        };

        setMessage(
          "authMessage",
          messages[error.code] || `Gagal memproses akun (${error.code || "kesalahan"}).`,
          "error"
        );
      } finally {
        authRequestRunning = false;
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  if (toggleButton) {
    toggleButton.addEventListener("click", () => {
      signupMode = !signupMode;

      const submitButton = $("authSubmit");
      const passwordInput = $("authPassword");

      if (submitButton) {
        submitButton.textContent = signupMode ? "Buat akun" : "Masuk";
      }

      if (passwordInput) {
        passwordInput.autocomplete = signupMode
          ? "new-password"
          : "current-password";
      }

      toggleButton.textContent = signupMode
        ? "Sudah punya akun? Masuk"
        : "Belum punya akun? Buat akun baru";

      setMessage("authMessage", "");
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Logout gagal:", error);
        alert("Logout gagal. Periksa koneksi internet.");
      }
    });
  }
}

// ========================================
// 12. SINKRONISASI FIRESTORE
// ========================================

async function listenToUserData(user) {
  if (unsubscribeData) {
    unsubscribeData();
    unsubscribeData = null;
  }

  currentUser = user;
  dataReady = false;
  saveQueue = Promise.resolve();

  showApp(true);

  setMessage(
    "authMessage",
    "Memuat data akun..."
  );

  const userDoc = doc(
    db,
    "users",
    user.uid,
    "appData",
    "main"
  );

  try {
    const firstSnapshot = await getDoc(userDoc);

    if (currentUser?.uid !== user.uid) return;

    if (!firstSnapshot.exists()) {
      // Akun baru memakai anggaran awal.
      // Data lokal lama tidak ditimpa ke cloud secara otomatis.
      const initialState = cloneDefaults();
      await setDoc(userDoc, initialState);
    }
  } catch (error) {
    console.error("Gagal memeriksa dokumen cloud:", error);

    setMessage(
      "authMessage",
      "Tidak dapat mengakses Firestore. Periksa aturan database dan koneksi.",
      "error"
    );
    return;
  }

  if (currentUser?.uid !== user.uid) return;

  unsubscribeData = onSnapshot(
    userDoc,
    snapshot => {
      if (currentUser?.uid !== user.uid) return;

      if (!snapshot.exists()) {
        setMessage(
          "authMessage",
          "Data akun belum tersedia di cloud.",
          "error"
        );
        return;
      }

      try {
        applyingCloudData = true;
        state = cleanState(snapshot.data());

        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

        dataReady = true;
        render();

        setMessage(
          "authMessage",
          "Data akun berhasil dimuat dan sinkron.",
          "success"
        );
      } catch (error) {
        console.error("Data cloud tidak valid:", error);
        dataReady = false;

        setMessage(
          "authMessage",
          "Format data cloud tidak valid. Data tidak diubah.",
          "error"
        );
      } finally {
        applyingCloudData = false;
      }
    },
    error => {
      console.error("Sinkronisasi Firestore gagal:", error);
      dataReady = false;

      setMessage(
        "authMessage",
        "Sinkronisasi gagal. Periksa koneksi dan aturan Firestore.",
        "error"
      );
    }
  );
}

// ========================================
// 13. JALANKAN APLIKASI
// ========================================

wireAuth();
wireBudget();
wireTransactions();
wireBackup();

showApp(false);

onAuthStateChanged(auth, user => {
  if (unsubscribeData) {
    unsubscribeData();
    unsubscribeData = null;
  }

  currentUser = user;
  dataReady = false;

  if (user) {
    listenToUserData(user);
  } else {
    showApp(false);
    setMessage("authMessage", "");
  }
});

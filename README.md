# Ruang Dana — Starter

Website pengelola anggaran bulanan menggunakan HTML, CSS, dan JavaScript.

## File
- `index.html`: struktur halaman dan formulir.
- `style.css`: tampilan responsif.
- `app.js`: alokasi, validasi transaksi, LocalStorage, ekspor/impor cadangan.
- `firebase.js`: catatan persiapan integrasi Firebase.
- `firestore.rules`: aturan awal per pengguna; perlu diuji sesuai skema data sebelum dipakai.

## Jalankan lokal
Buka `index.html` di browser. Untuk pengembangan yang lebih nyaman, gunakan ekstensi Live Server di VS Code.

## Publikasikan dengan GitHub Pages
1. Buat repository GitHub bernama `ruang-dana`.
2. Unggah file website ke root repository.
3. Buka **Settings → Pages**.
4. Di **Build and deployment**, pilih **Deploy from a branch**.
5. Pilih branch `main` dan folder `/(root)`, lalu tekan **Save**.
6. Tunggu proses deployment dan buka URL yang ditampilkan GitHub Pages.

## Catatan penting
Versi starter ini menyimpan data di LocalStorage browser, jadi data tidak otomatis tersinkron antarperangkat. Ekspor cadangan secara berkala. Jangan mengunggah file cadangan ke repository publik.

Firebase belum dihubungkan. Sebelum menggunakan data keuangan nyata, implementasikan login, sinkronisasi lintas perangkat, aturan Firestore yang sesuai, dan validasi transaksi yang aman di sisi server. Validasi JavaScript di browser saja tidak cukup untuk keamanan.

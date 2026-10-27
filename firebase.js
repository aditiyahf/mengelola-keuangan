/*
 * Firebase belum diaktifkan.
 * Langkah berikutnya:
 * 1. Buat project di https://console.firebase.google.com/
 * 2. Aktifkan Authentication (misalnya Email/Password).
 * 3. Buat Cloud Firestore.
 * 4. Daftarkan aplikasi Web dan masukkan konfigurasi Firebase.
 * 5. Implementasikan sinkronisasi per pengguna dan transaksi atomik.
 *
 * Jangan pernah menaruh service-account private key di kode browser.
 * Konfigurasi Firebase web bukan kata sandi, tetapi akses data wajib
 * dilindungi oleh Firestore Security Rules dan validasi server.
 */
export const firebaseSetupComplete = false;

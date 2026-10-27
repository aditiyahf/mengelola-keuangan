
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBGizNkUFJWJV-WNcaUhzSgRzUUwFmCFdQ",
  authDomain: "mengelola-uang.firebaseapp.com",
  databaseURL: "https://mengelola-uang-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mengelola-uang",
  storageBucket: "mengelola-uang.firebasestorage.app",
  messagingSenderId: "51741658948",
  appId: "1:51741658948:web:74278292e599226e335111"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);


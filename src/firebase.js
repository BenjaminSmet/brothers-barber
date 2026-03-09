// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCHwWfGWehzh1Kz1bJRnlovBWNAEa0hb0Y",
  authDomain: "barber-benjamin.firebaseapp.com",
  projectId: "barber-benjamin",
  storageBucket: "barber-benjamin.firebasestorage.app",
  messagingSenderId: "926740077483",
  appId: "1:926740077483:web:6ab27f75e2c90c183e90ee",
  measurementId: "G-T6ELZZFFMD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
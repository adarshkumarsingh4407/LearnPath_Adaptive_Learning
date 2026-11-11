import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend
} from "firebase/ai";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCrzFALuy1EASlax0AaKDXMrsyNQnGYfGY",
  authDomain: "learnpath-81a87.firebaseapp.com",
  projectId: "learnpath-81a87",
  storageBucket: "learnpath-81a87.firebasestorage.app",
  messagingSenderId: "735766414778",
  appId: "1:735766414778:web:b6d3090b591bae9a4dc983",
  measurementId: "G-9TWCMHRHQB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Authentication
export const auth = getAuth(app);

// Firestore Database
export const db = getFirestore(app);

// Initialize Gemini AI
const ai = getAI(app, {
  backend: new GoogleAIBackend()
});

// Gemini Model
export const model = getGenerativeModel(ai, {
  model: "gemini-3.8-flash"
});

export default app;
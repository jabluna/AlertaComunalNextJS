import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyBg7GI6Pq4a6P71nBk3U6qR0dgO2teph30",
  authDomain: "food-services-2a596.firebaseapp.com",
  databaseURL: "https://food-services-2a596-default-rtdb.firebaseio.com",
  projectId: "food-services-2a596",
  storageBucket: "food-services-2a596.appspot.com",
  messagingSenderId: "723844406414",
  appId: "1:723844406414:web:cc5f5d3303b020377dfddf",
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

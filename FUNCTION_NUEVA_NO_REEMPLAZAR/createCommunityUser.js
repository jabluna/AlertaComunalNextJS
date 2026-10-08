/**
 * AGREGAR esta función al proyecto de Cloud Functions EXISTENTE.
 * NO reemplazar sendCommunityNotification ni las demás funciones actuales.
 * Requiere firebase-functions y firebase-admin ya inicializado en tu index.js.
 *
 * Si tu index.js ya contiene: const admin = require('firebase-admin'); admin.initializeApp();
 * no vuelvas a inicializar Admin.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.createCommunityUser = functions.https.onCall(async (data) => {
  const clientCode = String(data?.clientCode || "").trim();
  const identification = String(data?.identification || "").trim();
  const adminPassword = String(data?.adminPassword || "");
  const email = String(data?.email || "").trim().toLowerCase();
  const password = String(data?.password || "");
  const displayName = String(data?.displayName || "").trim();
  const nickname = String(data?.nickname || "").trim();
  const phoneNumber = String(data?.phoneNumber || "").trim();

  if (!clientCode || !identification || !adminPassword || !email || !displayName || password.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan datos obligatorios o la contraseña temporal tiene menos de 6 caracteres.");
  }

  const db = admin.database();
  const profileRef = db.ref(`clients/${clientCode}/perfil/${identification}/datos`);
  const profileSnap = await profileRef.once("value");
  if (!profileSnap.exists()) throw new functions.https.HttpsError("permission-denied", "No se encontró el perfil administrador de este nodo.");
  const profile = profileSnap.val() || {};

  // Misma base de validación usada actualmente por el login web: contraseña del perfil.
  if (String(profile.password || "") !== adminPassword) {
    throw new functions.https.HttpsError("permission-denied", "La contraseña del administrador no es correcta.");
  }

  const encodedEmail = email.replace(/\./g, ",");
  const allowedRef = db.ref(`clients/${clientCode}/allowedEmails`);
  const [allowedSnap, existingAllowedSnap] = await Promise.all([
    allowedRef.once("value"),
    allowedRef.child(encodedEmail).once("value")
  ]);
  const maxAllowed = Number(profile.emailsDisponibles || 0);
  const currentCount = allowedSnap.exists() ? Object.values(allowedSnap.val() || {}).filter(v => v === true).length : 0;
  if (!existingAllowedSnap.exists() && maxAllowed > 0 && currentCount >= maxAllowed) {
    throw new functions.https.HttpsError("resource-exhausted", `El plan permite máximo ${maxAllowed} usuarios.`);
  }

  let userRecord;
  let existingAuthUser = false;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
    existingAuthUser = true;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    userRecord = await admin.auth().createUser({ email, password, displayName, emailVerified: false, disabled: false });
  }

  const uid = userRecord.uid;
  const userData = {
    clientId: clientCode,
    displayName,
    email,
    nickname,
    phoneNumber,
    createdFrom: "admin_web_nextjs",
    createdAt: admin.database.ServerValue.TIMESTAMP
  };

  const updates = {};
  updates[`clients/${clientCode}/allowedEmails/${encodedEmail}`] = true;
  updates[`clients/${clientCode}/users/${uid}/clientId`] = clientCode;
  updates[`clients/${clientCode}/users/${uid}/displayName`] = displayName;
  updates[`clients/${clientCode}/users/${uid}/email`] = email;
  updates[`clients/${clientCode}/users/${uid}/nickname`] = nickname;
  updates[`clients/${clientCode}/users/${uid}/phoneNumber`] = phoneNumber;
  updates[`clients/${clientCode}/users/${uid}/createdFrom`] = userData.createdFrom;
  updates[`clients/${clientCode}/users/${uid}/createdAt`] = admin.database.ServerValue.TIMESTAMP;
  updates[`clients/${clientCode}/users/${uid}/registeredAt`] = admin.database.ServerValue.TIMESTAMP;
  updates[`usersGlobal/${uid}/email`] = email;
  updates[`usersGlobal/${uid}/communities/${clientCode}`] = true;
  updates[`multiNodos/${encodedEmail}/nodos/${clientCode}`] = true;
  await db.ref().update(updates);

  return { ok: true, uid, existingAuthUser };
});

"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { get, ref } from "firebase/database";
import { db } from "@/lib/firebase";
import styles from "./login.module.css";

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}
function emailKey(email: string) {
  return normalizeEmail(email).replace(/\./g, ",");
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [codigoCliente, setCodigoCliente] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{text:string; type:"error"|"success"|"warning"}|null>(null);

  useEffect(() => {
    const code = localStorage.getItem("loggedInClientCode");
    const identification = localStorage.getItem("loggedInClientIdentification");
    if (code && identification) router.replace("/admin/dashboard");
  }, [router]);

  async function emailHasMultiNodeAccess(userEmail:string, code:string) {
    const key = emailKey(userEmail);
    const paths = [
      `multiNodos/${key}/nodos/${code}`,
      `multiNodos/${key}/${code}`,
      `multiNodeOwners/${key}/${code}`,
    ];
    for (const path of paths) {
      const snap = await get(ref(db, path));
      if (snap.exists() && snap.val()) return true;
    }
    return false;
  }

  async function validateClientProfile(code:string, enteredEmail:string, enteredPassword:string, passwordMatchesClientCode:boolean) {
    const perfilSnapshot = await get(ref(db, `clients/${code}/perfil`));
    if (!perfilSnapshot.exists()) return {ok:false, message:"No se encontró el perfil de esta comunidad."};

    const perfilData = perfilSnapshot.val() || {};
    const normalizedEnteredEmail = normalizeEmail(enteredEmail);

    for (const identificationKey of Object.keys(perfilData)) {
      const userData = perfilData[identificationKey]?.datos;
      if (!userData) continue;

      const emailMatches =
        normalizeEmail(userData.email) === normalizedEnteredEmail ||
        normalizeEmail(userData.emailPersona) === normalizedEnteredEmail;
      if (!emailMatches) continue;

      const storedPassword = String(userData.password || "").trim();
      const passwordMatchesProfile = Boolean(storedPassword && storedPassword === enteredPassword);
      if (!passwordMatchesProfile && !passwordMatchesClientCode)
        return {ok:false, message:"Email o Contraseña incorrecto."};

      if ((userData.estado || "activo") === "bloqueado")
        return {ok:false, message:"Acceso denegado: Su cuenta se encuentra bloqueada por falta de pago o revisión. Contacte al administrador."};

      if (userData.fechaCulminacion && userData.fechaCulminacion !== "N/A") {
        const fechaFin = new Date(`${userData.fechaCulminacion}T00:00:00`);
        const hoy = new Date(); hoy.setHours(0,0,0,0);
        if (!Number.isNaN(fechaFin.getTime()) && fechaFin < hoy)
          return {ok:false, message:"Acceso denegado: Su suscripción ha vencido. Por favor, renueve su plan para continuar."};
      }
      return {ok:true, identificationKey};
    }
    return {ok:false, message:"Email o Contraseña incorrecto."};
  }

  function saveSessionAndRedirect(code:string, identificationKey:string, userEmail:string) {
    localStorage.setItem("loggedInClientCode", code);
    localStorage.setItem("loggedInClientIdentification", identificationKey || "");
    localStorage.setItem("loggedInUserEmail", userEmail);
    localStorage.setItem("userEmail", userEmail);
    localStorage.setItem("selectedClientNode", code);
    localStorage.setItem("activeClientCode", code);
    localStorage.setItem("activeClientIdentification", identificationKey || "");
    localStorage.removeItem("isMasterLogin");

    const finish = (lat?:number, lng?:number) => {
      if (lat !== undefined && lng !== undefined) {
        localStorage.setItem("userLatitude", String(lat));
        localStorage.setItem("userLongitude", String(lng));
      }
      router.replace("/admin/dashboard");
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => finish(p.coords.latitude, p.coords.longitude),
        () => finish(),
        {enableHighAccuracy:false, timeout:8000, maximumAge:60000}
      );
    } else finish();
  }

  async function handleSubmit(e:FormEvent) {
    e.preventDefault();
    setMessage(null);
    const code = codigoCliente.trim();
    const userEmail = email.trim();
    const pass = password.trim();
    if (!code || !userEmail || !pass) {
      setMessage({text:"Por favor, complete todos los campos.",type:"warning"});
      return;
    }

    setLoading(true);
    try {
      const clientCodeSnapshot = await get(ref(db, `clientCodes/${pass}`));
      if (!clientCodeSnapshot.exists()) {
        setMessage({text:"Código de Cliente, Email o Contraseña incorrecto.",type:"error"});
        return;
      }

      const codigoDesdePassword = String(clientCodeSnapshot.val() || "").trim();
      const passwordMatchesEnteredNode = codigoDesdePassword === code;
      let canTryEnteredNode = passwordMatchesEnteredNode;
      if (!canTryEnteredNode) canTryEnteredNode = await emailHasMultiNodeAccess(userEmail, code);

      if (!canTryEnteredNode) {
        setMessage({text:"Código de Cliente o Contraseña incorrecto.",type:"error"});
        return;
      }

      const result:any = await validateClientProfile(code,userEmail,pass,passwordMatchesEnteredNode);
      if (!result.ok) {
        setMessage({text:result.message || "Datos incorrectos.",type:"error"});
        return;
      }

      setMessage({text:"Inicio de sesión exitoso. Cargando comunidad...",type:"success"});
      saveSessionAndRedirect(code,result.identificationKey,userEmail);
    } catch (err) {
      console.error(err);
      setMessage({text:"Ocurrió un error al intentar iniciar sesión. Por favor, inténtelo de nuevo.",type:"error"});
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <section className={styles.card}>
      <div className={styles.brand}>
        <div className={styles.mark}>AC</div>
        <div><strong>Alerta Comunal</strong><span>ADMINISTRACIÓN DE COMUNIDAD</span></div>
      </div>
      <div className={styles.heading}>
        <span>ACCESO SEGURO</span>
        <h1>Bienvenido</h1>
        <p>Ingresa a la administración de tu comunidad.</p>
      </div>
      <form onSubmit={handleSubmit}>
        <label>Mi Comunidad<input value={codigoCliente} onChange={e=>setCodigoCliente(e.target.value)} placeholder="Ej. ALCON 1" autoComplete="organization"/></label>
        <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="correo@ejemplo.com" autoComplete="email"/></label>
        <label>Contraseña<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password"/></label>
        <button disabled={loading}>{loading ? <><i/> Validando...</> : "Ingresar al panel"}</button>
        {message && <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>}
      </form>
      <footer><span/> Conexión protegida con Firebase</footer>
    </section>
    <aside className={styles.visual}>
      <div className={styles.radar}><i/><i/><i/><b>+</b></div>
      <h2>Tu comunidad.<br/>En tiempo real.</h2>
      <p>Monitorea sucesos, alertas de pánico y actividad de tu nodo desde un solo lugar.</p>
    </aside>
  </main>;
}

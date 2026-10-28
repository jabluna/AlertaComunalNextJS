"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadBytes, getDownloadURL, ref as storageRef } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { get, onValue, push, ref, remove, serverTimestamp, set, Unsubscribe } from "firebase/database";
import { app, auth, db, functions } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";
import styles from "./dashboard.module.css";

declare global {
  interface Window { google?: any; }
}

type AnyRecord = Record<string, any>;
type Incident = AnyRecord & { incidentId?: string; incidentType?: string; clientCode?: string };
type NodeItem = { label: string; code: string; identification?: string };
type ProfileResult = { identification: string; data: AnyRecord };

const MAPS_ID = "alerta-admin-google-maps";
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "AIzaSyDRGfVr-bgjkZElihtyod1Xnr2-2qwT9ps";
const NIGHT = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
];

function encodeEmail(email: string) { return String(email || "").trim().replace(/[.#$/\[\]]/g, ","); }
function normalizeEmail(email: string) { return String(email || "").trim().toLowerCase(); }
function typeOf(i: Incident) { return String(i?.incidentType || i?.type || "otro").toLowerCase(); }
function coords(i: Incident | null) {
  if (!i) return null;
  const lat = Number(i?.location?.lat ?? i?.lat);
  const lng = Number(i?.location?.lng ?? i?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

let mapsPromise: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const started = Date.now();
    const waitUntilReady = () => {
      if (window.google?.maps?.importLibrary) { resolve(); return; }
      if (Date.now() - started > 15000) { mapsPromise = null; reject(new Error("Google Maps no respondió.")); return; }
      window.setTimeout(waitUntilReady, 80);
    };
    const old = document.getElementById(MAPS_ID) as HTMLScriptElement | null;
    if (old) { waitUntilReady(); return; }
    const script = document.createElement("script");
    script.id = MAPS_ID;
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&loading=async`;
    script.onload = waitUntilReady;
    script.onerror = () => { mapsPromise = null; reject(new Error("No fue posible cargar Google Maps.")); };
    document.head.appendChild(script);
    waitUntilReady();
  });
  return mapsPromise;
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("alertaAdminTheme");
    const nextDark = saved === "dark";
    setDark(nextDark);
    document.documentElement.dataset.adminTheme = nextDark ? "dark" : "light";
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("alertaAdminTheme", next ? "dark" : "light");
    document.documentElement.dataset.adminTheme = next ? "dark" : "light";
    window.dispatchEvent(new CustomEvent("alerta-admin-theme", { detail: next ? "dark" : "light" }));
  };
  return <button type="button" className={styles.themeToggle} onClick={toggle} title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}>{dark ? "☀" : "☾"}<span>{dark ? "Claro" : "Oscuro"}</span></button>;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [identification, setIdentification] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<AnyRecord | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [panics, setPanics] = useState<AnyRecord[]>([]);
  const [liveSessions, setLiveSessions] = useState<AnyRecord[]>([]);
  const [liveRecordings, setLiveRecordings] = useState<AnyRecord[]>([]);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveViewed, setLiveViewed] = useState<AnyRecord | null>(null);
  const liveMapEl = useRef<HTMLDivElement | null>(null);
  const [liveVideoUrl, setLiveVideoUrl] = useState("");
  const [liveVideoError, setLiveVideoError] = useState("");
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveDeleting, setLiveDeleting] = useState<string | null>(null);
  const [liveResolvedNames, setLiveResolvedNames] = useState<Record<string,string>>({});
  const seenLiveIdsRef = useRef<Set<string> | null>(null);
  const [panicOpen, setPanicOpen] = useState(false);
  const [panicMuted, setPanicMuted] = useState(false);
  const [panicFocus, setPanicFocus] = useState<AnyRecord | null>(null);
  const [filter, setFilter] = useState("all");
  const [online, setOnline] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [comments, setComments] = useState<AnyRecord[]>([]);
  const [sharing, setSharing] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [communityAlarmOpen, setCommunityAlarmOpen] = useState(false);
  const [sendingAlarm, setSendingAlarm] = useState<string | null>(null);
  const [alarmMessage, setAlarmMessage] = useState("");
  const [thirtyDaysAgo] = useState(() => Date.now() - 30 * 86400000);
  const listenersRef = useRef<Unsubscribe[]>([]);
  const commentUnsubRef = useRef<Unsubscribe | null>(null);
  const panicAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousPanicKeysRef = useRef<Set<string>>(new Set());

  const logout = useCallback(() => {
    ["loggedInClientCode", "loggedInClientIdentification", "isMasterLogin", "userEmail", "loggedInUserEmail", "activeClientCode", "activeClientIdentification", "selectedClientNode"].forEach(k => localStorage.removeItem(k));
    void signOut(auth);
    router.replace("/admin/login");
  }, [router]);

  const findProfile = useCallback(async (clientCode: string, preferred?: string, userEmail?: string): Promise<ProfileResult | null> => {
    if (preferred) {
      const direct = await get(ref(db, `clients/${clientCode}/perfil/${preferred}/datos`));
      if (direct.exists()) return { identification: preferred, data: direct.val() };
    }
    const snap = await get(ref(db, `clients/${clientCode}/perfil`));
    if (!snap.exists()) return null;
    const all = snap.val() || {};
    let fallback: ProfileResult | null = null;
    for (const key of Object.keys(all)) {
      const data = all[key]?.datos;
      if (!data) continue;
      if (!fallback) fallback = { identification: key, data };
      const emails = [data.email, data.emailPersona].filter(Boolean).map(normalizeEmail);
      if (userEmail && emails.includes(normalizeEmail(userEmail))) return { identification: key, data };
    }
    return fallback;
  }, []);

  const clearNodeListeners = useCallback(() => {
    listenersRef.current.forEach(unsub => unsub());
    listenersRef.current = [];
  }, []);

  const loadNode = useCallback(async (clientCode: string, preferred?: string) => {
    const userEmail = localStorage.getItem("loggedInUserEmail") || localStorage.getItem("userEmail") || "";
    const result = await findProfile(clientCode, preferred, userEmail);
    if (!result) { logout(); return; }

    clearNodeListeners();
    if (commentUnsubRef.current) { commentUnsubRef.current(); commentUnsubRef.current = null; }
    setCode(clientCode);
    setIdentification(result.identification);
    setProfile(result.data);
    setSelected(null);
    setComments([]);
    setLiveSessions([]);
    setLiveRecordings([]);
    setLiveOpen(false);
    setLiveViewed(null);
    seenLiveIdsRef.current = null;
    localStorage.setItem("activeClientCode", clientCode);
    localStorage.setItem("activeClientIdentification", result.identification);
    const share = result.data?.sharing_settings;
    setSharing(Boolean(share?.enabled && share?.timestamp && Date.now() - Number(share.timestamp) < 86400000));

    const incidentsRef = ref(db, `clients/${clientCode}/sucesos`);
    const unsubIncidents = onValue(incidentsRef, snap => {
      const root = snap.val() || {};
      const list: Incident[] = [];
      Object.keys(root).forEach(type => Object.keys(root[type] || {}).forEach(date => Object.keys(root[type][date] || {}).forEach(uid => Object.keys(root[type][date][uid] || {}).forEach(id => {
        const x = root[type][date][uid][id] || {};
        list.push({ ...x, incidentType: type, dateString: x.dateString || x.fecha || date, incidentId: id, firebaseUserId: uid, clientCode });
      }))));
      setIncidents(list.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)));
    });

    const panicRef = ref(db, `clients/${clientCode}/panico`);
    const unsubPanics = onValue(panicRef, async snap => {
      const value = snap.val() || {};
      const entries = Object.entries(value) as [string, AnyRecord][];
      const currentKeys = new Set(entries.map(([id]) => id));
      const hasNewAlert = entries.some(([id]) => !previousPanicKeysRef.current.has(id));
      previousPanicKeysRef.current = currentKeys;

      const nextPanics: AnyRecord[] = await Promise.all(entries.map(async ([id, raw]): Promise<AnyRecord> => {
        let userProfile: AnyRecord = {};
        if (raw?.userId) {
          try {
            const userSnap = await get(ref(db, `clients/${clientCode}/users/${raw.userId}`));
            if (userSnap.exists()) userProfile = userSnap.val() || {};
          } catch (error) { console.warn("No fue posible cargar el usuario de la alerta de pánico", error); }
        }
        return { ...userProfile, ...raw, id, panicKey: id };
      }));
      nextPanics.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
      setPanics(nextPanics);
      if (nextPanics.length > 0) {
        setPanicOpen(true);
        if (hasNewAlert && !panicMuted) {
          const audio = panicAudioRef.current;
          if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
        }
      } else {
        setPanicOpen(false);
        const audio = panicAudioRef.current;
        if (audio) { audio.pause(); audio.currentTime = 0; }
      }
    });
    const unsubLiveSessions = onValue(ref(db, `clients/${clientCode}/alertaLive/sessions`), snapshot => {
      const list = Object.entries(snapshot.val() || {}).map(([sessionId, raw]) => ({
        ...(raw as AnyRecord), sessionId, clientId: clientCode,
      })).sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
      setLiveSessions(list);
      const activeIds = new Set(list.filter(x => x.status === "live").map(x => x.sessionId));
      if ([...activeIds].some(id => !seenLiveIdsRef.current?.has(id))) {
        setLiveOpen(true);
        if (!panicMuted) {
          const audio = panicAudioRef.current;
          if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
        }
      }
      seenLiveIdsRef.current = activeIds;
    });
    const unsubLiveRecordings = onValue(ref(db, `clients/${clientCode}/alertaLive/recordings`), snapshot => {
      const list = Object.entries(snapshot.val() || {}).map(([sessionId, raw]) => ({
        ...(raw as AnyRecord), sessionId, clientId: clientCode,
      })).sort((a,b) => Number(b.startedAt || b.completedAt || 0) - Number(a.startedAt || a.completedAt || 0));
      setLiveRecordings(list);
    });
    listenersRef.current = [unsubIncidents, unsubPanics, unsubLiveSessions, unsubLiveRecordings];
  }, [clearNodeListeners, findProfile, logout, panicMuted]);

  useEffect(() => {
    let cancelled = false;
    void loadMaps().catch(error => console.error("Precarga de Google Maps:", error));
    const initialize = async () => {
      const clientCode = localStorage.getItem("loggedInClientCode");
      const clientIdentification = localStorage.getItem("loggedInClientIdentification");
      const userEmail = localStorage.getItem("loggedInUserEmail") || localStorage.getItem("userEmail") || "";
      if (!clientCode || !clientIdentification) { router.replace("/admin/login"); return; }
      const base = await findProfile(clientCode, clientIdentification, userEmail);
      if (!base || cancelled) { if (!cancelled) logout(); return; }
      setEmail(userEmail);
      const found: NodeItem[] = [{ label: "Principal", code: clientCode, identification: base.identification }];
      if (userEmail) {
        const snap = await get(ref(db, `multiNodos/${encodeEmail(userEmail)}/nodos`));
        const value = snap.val() || {};
        Object.entries(value).forEach(([label, raw]) => {
          if (!raw) return;
          const nodeCode = typeof raw === "string" ? raw : label;
          if (nodeCode !== clientCode && !found.some(n => n.code === nodeCode)) found.push({ label, code: nodeCode });
        });
      }
      if (cancelled) return;
      setNodes(found);
      await loadNode(clientCode, clientIdentification);
      if (!cancelled) { setReady(true); if (new URLSearchParams(window.location.search).get("perfil") === "1") setProfileOpen(true); }
    };
    initialize().catch(error => { console.error("Error iniciando dashboard:", error); if (!cancelled) router.replace("/admin/login"); });
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
      clearNodeListeners();
      if (commentUnsubRef.current) commentUnsubRef.current();
    };
  }, [clearNodeListeners, findProfile, loadNode, logout, router]);

  const counts = useMemo(() => {
    const result = { accidente: 0, hurto: 0, homicidio: 0, otro: 0 };
    incidents.forEach(i => {
      const recent = !i.timestamp || Number(i.timestamp) >= thirtyDaysAgo;
      const t = typeOf(i) as keyof typeof result;
      if (recent && t in result) result[t]++;
    });
    return result;
  }, [incidents, thirtyDaysAgo]);

  const visible = useMemo(() => incidents.filter(i => {
    const t = typeOf(i);
    const typeOk = filter === "all" || filter === "heatmap-only" || t === filter;
    const d = String(i.dateString || "").slice(0, 10);
    return typeOk && (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  }), [incidents, filter, dateFrom, dateTo]);

  const displayName = profile?.nombreComercial || profile?.razonSocial || profile?.nombresApellidos || profile?.emailPersona || profile?.email || code || "Comunidad";
  const logo = profile?.logoUrl || "";

  const toggleSharing = async () => {
    if (sharing) return;
    if (!window.confirm("Al activar esta opción, tu nodo podrá compartir información durante 24 horas. ¿Deseas continuar?")) return;
    await set(ref(db, `clients/${code}/perfil/${identification}/datos/sharing_settings`), { enabled: true, timestamp: Date.now() });
    setSharing(true);
  };

  const chooseIncident = useCallback((incident: Incident) => {
    setSelected(incident);
    if (commentUnsubRef.current) commentUnsubRef.current();
    if (!incident.incidentId) { setComments([]); return; }
    // El HTML/JS original guarda los comentarios globalmente en incidents/{incidentId}/comments.
    const commentRef = ref(db, `incidents/${incident.incidentId}/comments`);
    commentUnsubRef.current = onValue(commentRef, snap => {
      const value = snap.val() || {};
      setComments((Object.entries(value).map(([id, x]): AnyRecord => ({ id, ...(x as AnyRecord) })) as AnyRecord[]).sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0)));
    });
  }, [code]);

  const deleteIncident = useCallback(async (incident: Incident) => {
    const incidentCode = incident.clientCode || code;
    const incidentType = incident.incidentType || incident.type;
    const incidentDate = incident.dateString || incident.fecha || incident.date;
    const uid = incident.firebaseUserId;
    const id = incident.incidentId;
    if (!incidentCode || !incidentType || !incidentDate || !uid || !id) { window.alert("No se pudo identificar completamente el suceso."); return; }
    if (!window.confirm("¿Está seguro que desea eliminar este suceso? Esta acción no se puede deshacer.")) return;
    await remove(ref(db, `clients/${incidentCode}/sucesos/${incidentType}/${incidentDate}/${uid}/${id}`));
    if (selected?.incidentId === id) { setSelected(null); setComments([]); }
  }, [code, selected]);

  const togglePanicAudio = useCallback(() => {
    setPanicMuted(current => {
      const next = !current;
      sessionStorage.setItem("panicAudioSilenced", String(next));
      const audio = panicAudioRef.current;
      if (next && audio) { audio.pause(); audio.currentTime = 0; }
      else if (!next && panics.length > 0 && audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
      return next;
    });
  }, [panics.length]);

  const viewPanicOnMap = useCallback((panic: AnyRecord) => {
    setPanicFocus({ ...panic, _focusNonce: Date.now() });
    setPanicOpen(false);
  }, []);

  const openLiveRecording = useCallback(async (record: AnyRecord) => {
    setLiveViewed(record);
    setLiveVideoUrl("");
    setLiveVideoError("");
    setLiveLoading(true);
    try {
      if (!auth.currentUser) throw new Error("Vuelve a iniciar sesión en el panel para habilitar la reproducción segura.");
      const playback = httpsCallable<{clientId: string; sessionId: string}, {url: string}>(
        getFunctions(app, "southamerica-east1"), "alertaLivePlayback"
      );
      const response = await playback({clientId: code, sessionId: record.sessionId});
      if (!response.data?.url) throw new Error("No se recibió el enlace de reproducción.");
      setLiveVideoUrl(response.data.url);
    } catch (error: any) {
      setLiveVideoError(error?.message || "No se pudo abrir la grabación.");
    } finally {
      setLiveLoading(false);
    }
  }, [code]);

  const deleteLiveRecording = useCallback(async (record: AnyRecord) => {
    const sessionId = String(record.sessionId || "");
    if (!sessionId || liveDeleting) return;
    if (!window.confirm(`¿Eliminar definitivamente la grabación de ${record.publisherName || "este usuario"}? Se borrará el video de Storage y no se podrá recuperar.`)) return;
    setLiveDeleting(sessionId);
    try {
      const action = httpsCallable<{clientId:string;sessionId:string},{ok:boolean}>(
        getFunctions(app,"southamerica-east1"),"alertaLiveDeleteRecording"
      );
      await action({clientId:code,sessionId});
      if (liveViewed?.sessionId === sessionId) {
        setLiveViewed(null);
        setLiveVideoUrl("");
      }
    } catch (error:any) {
      window.alert(error?.message || "No fue posible eliminar la grabación.");
    } finally {
      setLiveDeleting(null);
    }
  },[code,liveDeleting,liveViewed]);

  useEffect(() => {
    const ids = [...liveRecordings,...liveSessions].map(x => String(x.publisherUid || "")).filter(Boolean);
    const missing = [...new Set(ids)].filter(uid => !liveResolvedNames[uid]);
    if (!code || !missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async uid => {
      try {
        const snapshot = await get(ref(db,`clients/${code}/users/${uid}`));
        const user = snapshot.val() || {};
        const name = [user.nombreCompleto,user.displayName,user.nombre,user.name,user.datos?.nombreCompleto,user.datos?.nombre,user.datos?.nombres].find(v => typeof v === "string" && v.trim());
        return [uid,name || "Usuario no identificado"] as const;
      } catch { return [uid,"Usuario no identificado"] as const; }
    })).then(items => {if(!cancelled) setLiveResolvedNames(prev=>({...prev,...Object.fromEntries(items)}));});
    return () => {cancelled=true;};
  },[code,liveRecordings,liveSessions,liveResolvedNames]);

  const deletePanic = useCallback(async (panic: AnyRecord) => {
    const key = panic.panicKey || panic.id;
    if (!key || !window.confirm("¿Está seguro que desea eliminar esta alerta de pánico?")) return;
    await remove(ref(db, `clients/${code}/panico/${key}`));
  }, [code]);

  const deleteAllPanics = useCallback(async () => {
    if (!panics.length || !window.confirm("¿Está seguro que desea eliminar TODAS las alertas de pánico activas? Esta acción no se puede deshacer.")) return;
    await remove(ref(db, `clients/${code}/panico`));
  }, [code, panics.length]);

  const sendCommunityAlarm = useCallback(async (buttonKey: string) => {
    if (!code || sendingAlarm) return;
    const labels: Record<string, string> = { general: "ALARMA GENERAL", ayuda: "AYUDA", hurto: "HURTO", protocolo: "PROTOCOLO DE SEGURIDAD" };
    if (!window.confirm(`¿Estás seguro de que quieres enviar "${labels[buttonKey] || buttonKey.toUpperCase()}" a todos los usuarios del nodo ${code}?`)) return;
    setSendingAlarm(buttonKey);
    setAlarmMessage("");
    try {
      let userId = identification || "web_panel";
      if (email) {
        const usersSnap = await get(ref(db, `clients/${code}/users`));
        if (usersSnap.exists()) {
          const users = usersSnap.val() || {};
          const match = Object.entries(users).find(([, value]) => normalizeEmail((value as AnyRecord)?.email) === normalizeEmail(email));
          if (match?.[0]) userId = match[0];
        }
      }
      const eventTexts: Record<string, string> = {
        ayuda: "Notificación de Ayuda enviada desde el panel web",
        protocolo: "Notificación de Protocolo enviada desde el panel web",
        general: "Notificación General enviada desde el panel web",
        hurto: "Notificación de Hurto enviada desde el panel web",
      };
      const now = new Date();
      const dateString = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const lat = Number(profile?.punto_inicial?.lat);
      const lng = Number(profile?.punto_inicial?.lng);
      const eventData: AnyRecord = {
        description: eventTexts[buttonKey] || `Notificación de ${buttonKey} enviada`,
        timestamp: serverTimestamp(), clientId: code, type: "Otro", status: "enviado", userId, dateString, origin: "web_panel",
      };
      if (Number.isFinite(lat) && Number.isFinite(lng)) eventData.location = { lat, lng };
      await push(ref(db, `clients/${code}/sucesos/otro/${dateString}/${userId}`), eventData);

      const callable = httpsCallable(functions, "sendCommunityNotification");
      await callable({ clientCode: code, buttonKey });
      setAlarmMessage(`✓ ${labels[buttonKey] || buttonKey} enviada correctamente al nodo ${code}.`);
    } catch (error: any) {
      console.error("Error enviando alarma comunitaria:", error);
      setAlarmMessage(`⚠ El evento fue procesado, pero no se pudo confirmar el envío de la notificación: ${error?.message || "error desconocido"}`);
    } finally {
      setSendingAlarm(null);
    }
  }, [code, email, identification, profile, sendingAlarm]);

  useEffect(() => {
    setPanicMuted(sessionStorage.getItem("panicAudioSilenced") === "true");
  }, []);

  if (!ready) return <main className={styles.loading}><i/><span>Validando acceso y cargando comunidad...</span></main>;

  return <main className={styles.page}>
    <aside className={`${styles.sidebar} ${sidebar ? styles.sidebarOpen : ""}`}>
      <div className={styles.brand}>{logo ? <img src={logo} alt="Logo"/> : <b>AC</b>}<div><strong>{profile?.nombreComercial || "Alerta Comunal"}</strong><span>ADMIN COMUNIDAD</span></div></div>
      <div className={styles.nodeLabel}>Nodo activo</div>
      <select className={styles.nodeSelect} value={code} onChange={e => loadNode(e.target.value)}>{nodes.map(n => <option key={n.code} value={n.code}>{n.label} ({n.code})</option>)}</select>
      <nav><button className={styles.active}>⌂ <span>Inicio</span></button><button onClick={() => router.push("/admin/comunidad")}>♟ <span>Mi Comunidad</span></button><button onClick={() => router.push("/admin/reportes")}>▤ <span>Reportes</span></button><button onClick={() => setProfileOpen(true)}>♙ <span>Mi perfil</span></button></nav>
      <div className={styles.sideBottom}><div className={styles.productMark}><img src="/logo1.png" alt="Monitor Peligro"/><span>Un producto de</span><strong>MONITOR PELIGRO</strong></div><div className={styles.status}><i className={online ? styles.greenDot : styles.redDot}/>{online ? "Conectado" : "Sin conexión"}</div></div>
    </aside>

    <section className={styles.content}>
      <header className={styles.header}><button className={styles.mobileMenu} onClick={() => setSidebar(v => !v)}>☰</button><div><span>ADMINISTRACIÓN</span><h1>{displayName}</h1><p>Nodo activo: <b>{code}</b></p></div><div className={styles.headerRight}><span className={styles.plan}>Plan {profile?.tipoPlan || "N/A"}</span><div className={styles.avatar}>{logo ? <img src={logo} alt=""/> : displayName.slice(0, 2).toUpperCase()}</div><div className={styles.hello}>Hola, <b>{displayName}</b></div><button type="button" className={styles.headerLogout} onClick={logout} title="Cerrar sesión">↪ <span>Cerrar sesión</span></button></div></header>
      <div className={styles.metrics}><Metric title="Accidentes" value={counts.accidente} tone="red" icon="⚠"/><Metric title="Hurtos" value={counts.hurto} tone="green" icon="▣"/><Metric title="Homicidios" value={counts.homicidio} tone="blue" icon="◆"/><Metric title="Otros" value={counts.otro} tone="yellow" icon="?"/></div>
      <button className={styles.alarm} onClick={() => { setAlarmMessage(""); setCommunityAlarmOpen(true); }}>⌁ &nbsp; ALARMA COMUNITARIA</button>
      {(liveSessions.some(x => x.status === "live") || liveRecordings.length > 0) && <button className={styles.panicBox} style={{background:"linear-gradient(110deg,#7f1d1d,#b91c1c)",marginTop:10}} onClick={() => setLiveOpen(true)}><div><strong>🔴 Alerta Live · {liveSessions.filter(x => x.status === "live").length} en vivo</strong><span>{liveRecordings.filter(x => x.status === "ready").length} grabaciones disponibles · Ver historial</span></div><b>▶</b></button>}
      {panics.length > 0 && <button className={styles.panicBox} onClick={() => setPanicOpen(true)}><div><strong>{panics.length} alerta(s) de pánico activa(s)</strong><span>Requieren atención inmediata en {code}</span></div><b>!</b></button>}
      <div className={styles.filters}>{[["all", "Todos"], ["accidente", "Accidentes"], ["hurto", "Hurtos"], ["homicidio", "Homicidios"], ["otro", "Otros"], ["heatmap-only", "Solo Mapa de Calor"]].map(([v, l]) => <button key={v} className={`${styles[`f_${v.replace("-", "_")}`] || ""} ${filter === v ? styles.filterActive : ""}`} onClick={() => setFilter(v)}>{l}</button>)}<label className={styles.share}><input type="checkbox" checked={sharing} disabled={sharing} onChange={toggleSharing}/><span/>Permitir ver mi nodo</label></div>
      <MapArea profile={profile} incidents={visible} heatOnly={filter === "heatmap-only"} selected={selected} panicFocus={panicFocus} onSelect={chooseIncident}/>
      <div className={styles.threeCols}>
        <section className={styles.panel}><div className={styles.panelHead}><h2>Sucesos por Fecha</h2></div>{nodes.length > 1 && <div className={styles.incidentNodeFilter}><label>SELECCIONAR NODO:</label><select value={code} onChange={e => loadNode(e.target.value)}>{nodes.map(n => <option key={n.code} value={n.code}>{n.label === "Principal" ? `Principal (${n.code})` : `${n.label} (${n.code})`}</option>)}</select></div>}<div className={styles.dateFilters}><label>Desde<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}/></label><label>Hasta<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}/></label></div><div className={styles.list}>{visible.length ? visible.slice(0, 100).map(i => <div className={`${styles.incidentRow} ${selected?.incidentId === i.incidentId ? styles.selectedRow : ""}`} key={`${i.clientCode}-${i.incidentType}-${i.incidentId}`} onClick={() => chooseIncident(i)}><i className={styles[`dot_${typeOf(i)}`]}/><div className={styles.incidentMain}><div className={styles.incidentTitle}><strong>{typeOf(i).toUpperCase()}</strong><span>{i.clientCode || code}</span></div><p>{i.description || i.descripcion || "Sin descripción"}</p><small>{i.dateString || "Fecha no disponible"}</small></div><div className={styles.incidentActions}><button type="button" className={styles.deleteBtn} title="Eliminar" onClick={e => { e.stopPropagation(); deleteIncident(i); }}>🗑</button><button type="button" className={styles.viewBtn} onClick={e => { e.stopPropagation(); chooseIncident(i); }}>Ver</button></div></div>) : <div className={styles.empty}>No hay sucesos para mostrar.</div>}</div></section>
        <section className={styles.panel}><div className={styles.panelHead}><h2>Detalles del Suceso</h2></div><IncidentDetails incident={selected}/></section>
        <section className={styles.panel}><div className={styles.panelHead}><h2>Comentarios de los Sucesos</h2></div><div className={styles.comments}>{!selected ? <p>Selecciona un suceso para ver los comentarios.</p> : comments.length ? comments.map(c => <article key={c.id}><b>{c.userNickname || c.nombre || c.usuario || "Anónimo"}{c.timestamp ? ` (${new Date(Number(c.timestamp)).toLocaleString()})` : ""}</b><span>{c.text || c.comentario || c.mensaje || c.texto || ""}</span>{(c.imageUrl || (c.photoUrls && Object.values(c.photoUrls)[0])) && <img src={String(c.imageUrl || Object.values(c.photoUrls)[0])} alt="Comentario"/>}{c.audioUrl && <audio controls src={c.audioUrl}/>}</article>) : <p>No hay comentarios para este suceso.</p>}</div></section>
      </div>
    </section>
    <ThemeToggle/><audio ref={panicAudioRef} src="/panic-alert.wav" preload="auto"/>
    {panicOpen && panics.length > 0 && <PanicModal panics={panics} muted={panicMuted} onToggleMute={togglePanicAudio} onClose={() => setPanicOpen(false)} onView={viewPanicOnMap} onDelete={deletePanic} onDeleteAll={deleteAllPanics}/>}
    {liveOpen && <div className={styles.panicModalBack} style={{zIndex:100000}}><div className={styles.panicModal} style={{maxWidth:760,width:"min(94vw,760px)",maxHeight:"90vh",overflowY:"auto"}}><div className={styles.panicModalHead}><div className={styles.panicTitle}><span>🔴</span><strong>ALERTA LIVE · {code}</strong></div><div className={styles.panicHeadActions}><button className={styles.panicCloseX} onClick={() => {setLiveOpen(false);setLiveViewed(null);setLiveVideoUrl("");}}>×</button></div></div><div className={styles.panicModalBody}>
      <p>Transmisiones del nodo y grabaciones almacenadas.</p>
      <div className={styles.panicList}>
      {liveSessions.filter(x => x.status === "live").map(x => <article className={styles.panicItem} key={x.sessionId}><div className={styles.panicAlertIcon}>🔴</div><div className={styles.panicText}><strong>{x.publisherName || "Vecino"} <span>está transmitiendo en vivo</span></strong><small>{new Date(Number(x.startedAt || Date.now())).toLocaleString("es-CO")}</small><small>La transmisión está activa. Su grabación aparecerá cuando finalice y se procese.</small></div></article>)}
      {liveRecordings.filter(x => x.status === "ready").map(x => <article key={x.sessionId} style={{display:"flex",alignItems:"center",gap:14,padding:16,border:"1px solid #e2e8f0",borderRadius:16,background:"linear-gradient(125deg,#fff,#f8fafc)",boxShadow:"0 5px 18px rgba(15,23,42,.06)",flexWrap:"wrap"}}><div style={{width:48,height:48,borderRadius:14,display:"grid",placeItems:"center",fontSize:23,background:"#fee2e2"}}>🎬</div><div style={{flex:"1 1 200px",minWidth:0}}><strong style={{display:"block",fontSize:15,color:"#0f172a"}}>{liveResolvedNames[x.publisherUid] && liveResolvedNames[x.publisherUid] !== "Usuario no identificado" ? liveResolvedNames[x.publisherUid] : (x.publisherName || "Vecino")}</strong><small style={{display:"block",color:"#64748b",marginTop:4}}>{new Date(Number(x.startedAt || x.completedAt || Date.now())).toLocaleString("es-CO")}</small><span style={{display:"inline-block",marginTop:7,padding:"4px 9px",background:"#dcfce7",color:"#166534",fontSize:11,fontWeight:700,borderRadius:99}}>● VIDEO DISPONIBLE</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={{background:"#b91c1c",color:"white",border:0,borderRadius:10,padding:"11px 16px",fontWeight:700,cursor:"pointer"}} onClick={() => void openLiveRecording(x)}>▶ Reproducir</button><button type="button" disabled={liveDeleting === x.sessionId} style={{background:"#fff",color:"#b91c1c",border:"1px solid #fecaca",borderRadius:10,padding:"11px 14px",fontWeight:700,cursor:"pointer",opacity:liveDeleting === x.sessionId ? .5 : 1}} onClick={() => void deleteLiveRecording(x)}>{liveDeleting === x.sessionId ? "Eliminando..." : "🗑 Eliminar"}</button></div></article>)}
      {liveSessions.filter(x => x.status === "live").length === 0 && liveRecordings.filter(x => x.status === "ready").length === 0 && <p>No hay transmisiones activas ni videos disponibles.</p>}
      </div>
      
      </div><div className={styles.panicModalFoot}><button onClick={() => {setLiveOpen(false);setLiveViewed(null);setLiveVideoUrl("");}}>Cerrar</button></div></div></div>}
    {liveViewed && <div className={styles.panicModalBack} style={{zIndex:100010}}><div className={styles.panicModal} style={{width:"min(96vw,980px)",maxWidth:980,maxHeight:"94vh",overflowY:"auto"}}><div className={styles.panicModalHead}><div className={styles.panicTitle}><span>🎬</span><strong>GRABACIÓN ALERTA LIVE</strong></div><button className={styles.panicCloseX} onClick={() => {setLiveViewed(null);setLiveVideoUrl("");setLiveVideoError("");}}>×</button></div><div className={styles.panicModalBody} style={{display:"grid",gap:16}}>
      <div><strong>{liveResolvedNames[liveViewed.publisherUid] && liveResolvedNames[liveViewed.publisherUid] !== "Usuario no identificado" ? liveResolvedNames[liveViewed.publisherUid] : (liveViewed.publisherName || "Vecino")}</strong><p style={{margin:"6px 0"}}>Nodo: {code} · Fecha: {new Date(Number(liveViewed.startedAt || liveViewed.completedAt || Date.now())).toLocaleString("es-CO")}</p><small>Grabación de la comunidad · Identificador de sesión: {liveViewed.sessionId || "No disponible"}</small></div>
      {liveLoading ? <p>Cargando video...</p> : liveVideoError ? <p role="alert" style={{color:"#dc2626"}}>{liveVideoError}</p> : liveVideoUrl ? <video key={liveVideoUrl} src={liveVideoUrl} controls playsInline autoPlay style={{width:"100%",maxHeight:"52vh",background:"#000",borderRadius:12}}/> : null}
      <div><strong>📍 Origen de la transmisión</strong><LiveOriginMap location={liveViewed.location} mapEl={liveMapEl}/></div>
      </div><div className={styles.panicModalFoot}><button onClick={() => {setLiveViewed(null);setLiveVideoUrl("");setLiveVideoError("");}}>Cerrar reproductor</button></div></div></div>}
    {profileOpen && <ProfileModal code={code} identification={identification} profile={profile} onClose={() => setProfileOpen(false)} onSaved={setProfile}/>}
    {communityAlarmOpen && <CommunityAlarmModal code={code} sending={sendingAlarm} message={alarmMessage} onSend={sendCommunityAlarm} onClose={() => setCommunityAlarmOpen(false)}/>}
  </main>;
}

function LiveOriginMap({location,mapEl}:{location:any;mapEl:React.RefObject<HTMLDivElement | null>}) {
  const lat = Number(location?.lat ?? location?.latitude);
  const lng = Number(location?.lng ?? location?.longitude);
  const valid = location && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  useEffect(() => {
    if (!valid) return;
    let disposed = false;
    let map:any = null;
    loadMaps().then(async () => {
      await window.google?.maps?.importLibrary?.("maps");
      if (disposed || !mapEl.current || !window.google?.maps) return;
      map = new window.google.maps.Map(mapEl.current,{center:{lat,lng},zoom:16,mapTypeControl:true});
      const marker = new window.google.maps.Marker({position:{lat,lng},map,title:"Origen de Alerta Live"});
      const info = new window.google.maps.InfoWindow({content:"<strong>Origen de Alerta Live</strong><br/>"+lat.toFixed(6)+", "+lng.toFixed(6)});
      marker.addListener("click",()=>info.open(map,marker));
    }).catch(()=>{});
    return () => {disposed=true;map=null;};
  },[lat,lng,valid,mapEl]);
  return <div style={{marginTop:10}}>{valid ? <><p style={{margin:"6px 0"}}>Latitud: {lat.toFixed(6)} · Longitud: {lng.toFixed(6)}{location?.accuracy ? ` · Precisión: ${location.accuracy} m` : ""}</p><div ref={mapEl} style={{height:260,width:"100%",borderRadius:12,background:"#e2e8f0"}}/></> : <p>Esta grabación no contiene coordenadas de origen.</p>}</div>;
}

function CommunityAlarmModal({ code, sending, message, onSend, onClose }: { code: string; sending: string | null; message: string; onSend: (key: string) => void; onClose: () => void }) {
  const items = [
    { key: "general", title: "ALARMA GENERAL", icon: "◉", desc: "Aviso general para toda la comunidad", cls: "communityGeneral" },
    { key: "ayuda", title: "AYUDA", icon: "✚", desc: "Solicitud inmediata de ayuda", cls: "communityHelp" },
    { key: "hurto", title: "HURTO", icon: "!", desc: "Alerta por hurto o situación sospechosa", cls: "communityTheft" },
    { key: "protocolo", title: "PROTOCOLO SEGURIDAD", icon: "⬡", desc: "Activar protocolo de seguridad", cls: "communityProtocol" },
  ];
  return <div className={styles.communityModalBack} onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }}>
    <section className={styles.communityModal}>
      <header className={styles.communityModalHead}><div><span>CENTRO DE ALERTAS</span><h2>Alarma Comunitaria</h2><p>Nodo activo: <b>{code}</b></p></div><button onClick={onClose} disabled={!!sending}>×</button></header>
      <div className={styles.communityModalBody}><p>Selecciona el tipo de notificación que deseas enviar a todos los usuarios del nodo.</p><div className={styles.communityAlarmGrid}>{items.map(item => <button key={item.key} className={`${styles.communityAlarmCard} ${styles[item.cls]}`} disabled={!!sending} onClick={() => onSend(item.key)}><i>{sending === item.key ? "…" : item.icon}</i><strong>{sending === item.key ? "ENVIANDO..." : item.title}</strong><span>{item.desc}</span></button>)}</div>{message && <div className={message.startsWith("✓") ? styles.communitySuccess : styles.communityWarning}>{message}</div>}</div>
      <footer className={styles.communityModalFoot}><span>El envío utiliza la infraestructura actual de Firebase Functions.</span><button onClick={onClose} disabled={!!sending}>Cerrar</button></footer>
    </section>
  </div>;
}

function Metric({ title, value, tone, icon }: { title: string; value: number; tone: string; icon: string }) {
  return <div className={`${styles.metric} ${styles[`metric_${tone}`]}`}><div className={styles.metricIcon}>{icon}</div><div><span>{title} (Últ. 30d)</span><strong>{value}</strong></div></div>;
}

function MapArea({ profile, incidents, heatOnly, selected, panicFocus, onSelect }: { profile: AnyRecord | null; incidents: Incident[]; heatOnly: boolean; selected: Incident | null; panicFocus: AnyRecord | null; onSelect: (i: Incident) => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const streetEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const panoRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const heatRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState("");
  const [mapTheme, setMapTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const syncTheme = () => setMapTheme(document.documentElement.dataset.adminTheme === "dark" ? "dark" : "light");
    syncTheme();
    window.addEventListener("alerta-admin-theme", syncTheme as EventListener);
    return () => window.removeEventListener("alerta-admin-theme", syncTheme as EventListener);
  }, []);

  useEffect(() => {
    let active = true;
    setMapReady(false);
    setError("");
    loadMaps().then(async () => {
      if (!active || !mapEl.current || !streetEl.current || !window.google?.maps?.importLibrary) return;

      // Desde Maps JS actual, loading=async expone importLibrary primero.
      // Hay que importar las librerías antes de instanciar Map/StreetView.
      const mapsLib = await window.google.maps.importLibrary("maps");
      const streetLib = await window.google.maps.importLibrary("streetView");
      await window.google.maps.importLibrary("marker");
      if (!active || !mapEl.current || !streetEl.current) return;

      const lat = Number(profile?.punto_inicial?.lat);
      const lng = Number(profile?.punto_inicial?.lng);
      const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 4.3448, lng: -74.3712 };
      const MapCtor = mapsLib.Map || window.google.maps.Map;
      const InfoWindowCtor = mapsLib.InfoWindow || window.google.maps.InfoWindow;
      const StreetViewCtor = streetLib.StreetViewPanorama || window.google.maps.StreetViewPanorama;
      if (!MapCtor || !StreetViewCtor) throw new Error("Google Maps cargó, pero las librerías del mapa no están disponibles.");

      mapRef.current = new MapCtor(mapEl.current, { center, zoom: 15, styles: mapTheme === "dark" ? NIGHT : null, mapTypeControl: true, streetViewControl: true, fullscreenControl: true });
      panoRef.current = new StreetViewCtor(streetEl.current, { position: center, pov: { heading: 270, pitch: 0 }, zoom: 1, visible: true });
      mapRef.current.setStreetView(panoRef.current);
      // Busca la panorámica disponible más cercana; evita el panel gris cuando el punto exacto no tiene cobertura.
      const StreetViewServiceCtor = streetLib.StreetViewService || window.google.maps.StreetViewService;
      if (StreetViewServiceCtor) {
        const service = new StreetViewServiceCtor();
        service.getPanorama({ location: center, radius: 250, preference: window.google.maps.StreetViewPreference?.NEAREST }, (data: any, status: any) => {
          if (!active || !panoRef.current) return;
          if (status === "OK" && data?.location?.latLng) { panoRef.current.setPosition(data.location.latLng); panoRef.current.setVisible(true); }
        });
      }
      infoRef.current = InfoWindowCtor ? new InfoWindowCtor() : null;
      setMapReady(true);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Error cargando Google Maps."); });
    return () => {
      active = false;
      markersRef.current.forEach(marker => marker.setMap?.(null));
      markersRef.current = [];
      heatRef.current.forEach(layer => layer.setMap?.(null));
      heatRef.current = [];
      mapRef.current = null;
      panoRef.current = null;
      infoRef.current = null;
    };
  }, [profile?.punto_inicial?.lat, profile?.punto_inicial?.lng, mapTheme]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return;
    markersRef.current.forEach(marker => marker.setMap?.(null));
    markersRef.current = [];
    heatRef.current.forEach(layer => layer.setMap?.(null));
    heatRef.current = [];
    const points: any[] = [];

    incidents.forEach(incident => {
      const position = coords(incident);
      if (!position) return;
      points.push(new window.google.maps.LatLng(position.lat, position.lng));
      if (heatOnly) return;
      const t = typeOf(incident);
      const icon = t === "accidente" ? "/images/marker-red.svg" : t === "hurto" ? "/images/marker-green.svg" : t === "homicidio" ? "/images/marker-violet.svg" : t === "otro" ? "/images/marker-yellow.svg" : "/images/marker-blue.svg";
      const marker = new window.google.maps.Marker({ position, map: mapRef.current, title: `${t} (${incident.clientCode || ""})`, icon: { url: icon, scaledSize: new window.google.maps.Size(33, 60) } });
      marker.addListener("click", () => {
        onSelect(incident);
        mapRef.current?.panTo(position);
        if ((mapRef.current?.getZoom?.() || 0) < 16) mapRef.current?.setZoom(16);
        panoRef.current?.setPosition(position);
        infoRef.current?.setContent(`<div class="ac-map-info"><div class="ac-map-info__type">${t.toUpperCase()}</div><div class="ac-map-info__node">${incident.clientCode || ""}</div><div class="ac-map-info__date">${incident.dateString || ""}</div><div class="ac-map-info__desc">${incident.description || incident.descripcion || "Sin descripción"}</div></div>`);
        infoRef.current?.open({ anchor: marker, map: mapRef.current });
      });
      markersRef.current.push(marker);
    });

    // Google retiró visualization.HeatmapLayer en Maps JS 3.65.
    // Recreamos el mapa de calor con círculos concéntricos nativos para mantener
    // la vista sin depender de la API eliminada.
    if (points.length) {
      const heatColors = ["#ff3b30", "#ff9500", "#ffd60a"];
      incidents.forEach(incident => {
        const position = coords(incident);
        if (!position) return;
        const radii = heatOnly ? [115, 210, 330] : [70, 135, 220];
        const opacities = heatOnly ? [0.30, 0.18, 0.09] : [0.20, 0.11, 0.055];
        radii.forEach((radius, index) => {
          const circle = new window.google.maps.Circle({
            map: mapRef.current,
            center: position,
            radius,
            strokeOpacity: 0,
            fillColor: heatColors[index],
            fillOpacity: opacities[index],
            clickable: false,
            zIndex: 1,
          });
          heatRef.current.push(circle);
        });
      });
    }
  }, [incidents, heatOnly, mapReady, onSelect]);

  useEffect(() => {
    if (!mapReady) return;
    const position = coords(selected);
    if (position && mapRef.current) {
      mapRef.current.panTo(position);
      const Service = window.google?.maps?.StreetViewService;
      if (Service && panoRef.current) {
        new Service().getPanorama({ location: position, radius: 250, preference: window.google.maps.StreetViewPreference?.NEAREST }, (data: any, status: any) => {
          if (status === "OK" && data?.location?.latLng) { panoRef.current?.setPosition(data.location.latLng); panoRef.current?.setVisible(true); }
        });
      } else panoRef.current?.setPosition(position);
    }
  }, [selected, mapReady]);

  useEffect(() => {
    if (!mapReady || !panicFocus || !mapRef.current) return;
    const position = coords(panicFocus as Incident);
    if (!position) return;
    mapRef.current.panTo(position);
    mapRef.current.setZoom(18);
    panoRef.current?.setPosition(position);
    panoRef.current?.setVisible(true);
    const MarkerCtor = window.google?.maps?.Marker;
    if (MarkerCtor) {
      const marker = new MarkerCtor({ position, map: mapRef.current, title: "Alerta de pánico", zIndex: 9999 });
      window.setTimeout(() => marker.setMap?.(null), 9000);
    }
  }, [panicFocus, mapReady]);

  return <div className={styles.mapGrid}><section className={styles.panel}><div className={styles.panelHead}><h2>Mapa General</h2></div><div className={styles.googleMap} ref={mapEl}>{error && <div className={styles.mapError}>{error}</div>}</div></section><section className={styles.panel}><div className={styles.panelHead}><h2>Vista Street View</h2></div><div className={styles.street} ref={streetEl}/></section></div>;
}

function IncidentDetails({ incident }: { incident: Incident | null }) {
  if (!incident) return <div className={styles.detailsEmpty}>Selecciona un marcador en el mapa o un suceso de la lista para ver los detalles.</div>;
  const photos = incident.photoUrls && typeof incident.photoUrls === "object" ? Object.values(incident.photoUrls).filter(v => typeof v === "string") as string[] : [];
  return <div className={styles.details}><h3>Tipo: {incident.type || incident.incidentType || "N/A"}</h3><p><b>Fecha:</b> {incident.dateString || "N/A"}</p><p><b>Descripción:</b> {incident.description || incident.descripcion || "Sin descripción"}</p>{photos.length > 0 && <div className={styles.photos}>{photos.map((url, k) => <a key={k} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Foto del suceso"/></a>)}</div>}{incident.audioUrl && <audio controls src={incident.audioUrl}/>}</div>;
}


function PanicModal({ panics, muted, onToggleMute, onClose, onView, onDelete, onDeleteAll }: { panics: AnyRecord[]; muted: boolean; onToggleMute: () => void; onClose: () => void; onView: (panic: AnyRecord) => void; onDelete: (panic: AnyRecord) => void; onDeleteAll: () => void }) {
  const formatDate = (panic: AnyRecord) => {
    const raw = Number(panic.timestamp || panic.fechaTimestamp || 0);
    if (raw) return new Date(raw).toLocaleString("es-CO");
    return panic.fechaHora || panic.fecha || panic.dateString || "Fecha no disponible";
  };
  const nameOf = (panic: AnyRecord) => panic.displayName || panic.nombre || panic.nickname || panic.usuario || panic.userName || panic.email || "Usuario";
  return <div className={styles.panicModalBack}>
    <div className={styles.panicModal}>
      <div className={styles.panicModalHead}>
        <div className={styles.panicTitle}><span>⚠</span><strong>¡ALERTA DE PÁNICO ACTIVA!</strong></div>
        <div className={styles.panicHeadActions}>
          <button className={styles.panicMute} onClick={onToggleMute} title={muted ? "Activar sonido" : "Silenciar"}>{muted ? "🔊" : "🔇"}</button>
          <button className={styles.panicDeleteAll} onClick={onDeleteAll}>🗑 Eliminar</button>
          <button className={styles.panicCloseX} onClick={onClose}>×</button>
        </div>
      </div>
      <div className={styles.panicModalBody}>
        <p>Se han detectado las siguientes alertas de pánico:</p>
        <div className={styles.panicList}>
          {panics.map(panic => <article key={panic.id} className={styles.panicItem}>
            <div className={styles.panicAlertIcon}>⚠</div>
            <div className={styles.panicText}><strong>{nameOf(panic)} <span>ha activado una alerta.</span></strong><small>({formatDate(panic)})</small></div>
            <div className={styles.panicItemActions}>
              <button className={styles.panicMapBtn} onClick={() => onView(panic)} title="Ver en Mapa">⌖</button>
              <button className={styles.panicRemoveBtn} onClick={() => onDelete(panic)} title="Eliminar">×</button>
            </div>
          </article>)}
        </div>
      </div>
      <div className={styles.panicModalFoot}><button onClick={onClose}>Cerrar</button></div>
    </div>
  </div>;
}

function ProfileModal({ code, identification, profile, onClose, onSaved }: { code:string; identification:string; profile:AnyRecord|null; onClose:()=>void; onSaved:(x:AnyRecord)=>void }) {
  const [form,setForm]=useState<AnyRecord>(()=>JSON.parse(JSON.stringify(profile||{})));
  const [saving,setSaving]=useState(false); const [logoFile,setLogoFile]=useState<File|null>(null);
  const setF=(k:string,v:any)=>setForm((x:AnyRecord)=>({...x,[k]:v}));
  const save=async()=>{ setSaving(true); try { let next={...form}; if(logoFile){ if(logoFile.size>500*1024) throw new Error("El logo supera 500KB"); const sr=storageRef(storage,`logos/${code}/${identification}/${logoFile.name}`); await uploadBytes(sr,logoFile); next.logoUrl=await getDownloadURL(sr); } await set(ref(db,`clients/${code}/perfil/${identification}/datos`),next); onSaved(next); alert("Perfil actualizado exitosamente."); onClose(); } catch(e:any){alert("Error al guardar: "+e.message)} finally{setSaving(false)} };
  const empresa=form.tipo==="empresa";
  return <div className={styles.modalBack} onMouseDown={onClose}><div className={styles.modalCard} onMouseDown={e=>e.stopPropagation()}><div className={styles.modalHead}><h2>Editar Perfil</h2><button onClick={onClose}>×</button></div><div className={styles.modalBody}>
    <div className={styles.formGrid}>{empresa? <><label>NIT<input value={form.nit||""} readOnly/></label><label>Razón Social<input value={form.razonSocial||""} onChange={e=>setF("razonSocial",e.target.value)}/></label><label>Ciudad<input value={form.ciudad||""} onChange={e=>setF("ciudad",e.target.value)}/></label><label>Teléfono de Contacto<input value={form.telefonoContacto||""} onChange={e=>setF("telefonoContacto",e.target.value)}/></label><label className={styles.span2}>Dirección<input value={form.direccion||""} onChange={e=>setF("direccion",e.target.value)}/></label><label>Persona a Cargo<input value={form.personaCargoProyecto||""} onChange={e=>setF("personaCargoProyecto",e.target.value)}/></label><label>Teléfono Encargado<input value={form.telefonoPersonaEncargada||""} onChange={e=>setF("telefonoPersonaEncargada",e.target.value)}/></label></>:<><label>Cédula<input value={form.cedula||""} readOnly/></label><label>Nombres y Apellidos<input value={form.nombresApellidos||""} onChange={e=>setF("nombresApellidos",e.target.value)}/></label><label className={styles.span2}>Dirección<input value={form.direccionPersona||""} onChange={e=>setF("direccionPersona",e.target.value)}/></label><label>Ciudad<input value={form.ciudadPersona||""} onChange={e=>setF("ciudadPersona",e.target.value)}/></label><label>Barrio<input value={form.barrio||""} onChange={e=>setF("barrio",e.target.value)}/></label><label>Celular<input value={form.celular||""} onChange={e=>setF("celular",e.target.value)}/></label></>}
    <label className={styles.span2}>Dirección Inicial<input value={form.punto_inicial?.address||""} onChange={e=>setForm((x:AnyRecord)=>({...x,punto_inicial:{...(x.punto_inicial||{}),address:e.target.value}}))}/></label><label>Latitud<input value={form.punto_inicial?.lat||""} readOnly/></label><label>Longitud<input value={form.punto_inicial?.lng||""} readOnly/></label><label className={styles.span2}>Logo (Máx 500KB)<input type="file" accept="image/*" onChange={e=>setLogoFile(e.target.files?.[0]||null)}/>{form.logoUrl&&<img className={styles.logoPreview} src={form.logoUrl} alt="Logo"/>}</label>
    <label>Código Cliente<input value={form.codigoCliente||code} readOnly/></label><label>Email<input value={(empresa?form.email:form.emailPersona)||""} readOnly/></label><label>Tipo Plan<input value={form.tipoPlan||""} readOnly/></label><label>Valor Plan<input value={form.valorPlan||""} readOnly/></label><label>Fecha Activación<input value={form.fechaActivacion||""} readOnly/></label><label>Fecha Culminación<input value={form.fechaCulminacion||""} readOnly/></label></div></div><div className={styles.modalFoot}><button onClick={onClose}>Cerrar</button><button onClick={save} disabled={saving}>{saving?"Guardando...":"Guardar Cambios"}</button></div></div></div>
}

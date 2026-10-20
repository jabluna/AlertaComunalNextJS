"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { onValue, ref, get, set, update, remove, push } from "firebase/database";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { auth, db, storage, functions } from "@/lib/firebase";
import styles from "./dashboard.module.css";

type AnyData = Record<string, any>;

type ClientRow = AnyData & {
  rowKey: string;
  codigoCliente: string;
  identificacion: string;
};

const emptyClient = {
  clientType: "",
  nit: "",
  codigoClienteEmpresa: "",
  razonSocial: "",
  ciudadEmpresa: "",
  telefonoEmpresa: "",
  emailEmpresa: "",
  direccionEmpresa: "",
  personaCargo: "",
  telefonoPersonaCargo: "",
  cedula: "",
  codigoClientePersona: "",
  nombresApellidos: "",
  celularPersona: "",
  direccionPersona: "",
  ciudadPersona: "",
  barrioPersona: "",
  emailPersona: "",
  tipoPlan: "",
  valorPlan: "",
  emailsDisponibles: "0",
  fechaActivacion: "",
  password: "",
  activarChat: "no",
  habilitarLogo: "no",
  habilitarNombreComercial: "no",
  habilitarPanicoPorVoz: "no",
  initialAddress: "",
  initialLat: "",
  initialLng: "",
};

function completionDate(dateValue: string, plan: string) {
  if (!dateValue || !plan) return null;
  if (plan === "free") return "N/A";
  const d = new Date(dateValue + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  if (plan === "mensual") d.setMonth(d.getMonth() + 1);
  if (plan === "trimestral") d.setMonth(d.getMonth() + 3);
  if (plan === "semestral") d.setMonth(d.getMonth() + 6);
  if (plan === "anual") d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function safeEmailKey(email: string) {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

function displayAllowedKey(key: string) {
  return key.replace(/,/g, ".");
}

function clientName(row: ClientRow) {
  return row.tipo === "empresa" ? row.razonSocial || "N/A" : row.nombresApellidos || "N/A";
}

function clientEmail(row: ClientRow) {
  return row.tipo === "empresa" ? row.email || "" : row.emailPersona || "";
}

function statusFor(row: ClientRow) {
  if (row.estado === "bloqueado") return { text: "BLOQUEADO", tone: "danger" };
  if (!row.fechaCulminacion || row.fechaCulminacion === "N/A") return { text: row.tipoPlan === "free" ? "FREE" : "N/A", tone: "neutral" };
  const end = new Date(row.fechaCulminacion + "T00:00:00");
  const now = new Date(); now.setHours(0,0,0,0);
  const days = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (days < 0) return { text: "VENCIDO", tone: "danger" };
  if (days <= 10) return { text: `${days} DÍAS`, tone: "warning" };
  return { text: "ACTIVO", tone: "success" };
}

export default function MasterDashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [masters, setMasters] = useState<{key:string,email:string}[]>([]);
  const [multiNodes, setMultiNodes] = useState<any[]>([]);
  const [firebaseStatus, setFirebaseStatus] = useState("Verificando");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;
  const [tab, setTab] = useState<"clientes"|"multinodos"|"maestros"|"planes">("clientes");
  const [modal, setModal] = useState<null|"client"|"delete"|"multi"|"master"|"choice"|"additional">(null);
  const [form, setForm] = useState<any>(emptyClient);
  const [editing, setEditing] = useState<ClientRow|null>(null);
  const [logoFile, setLogoFile] = useState<File|null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow|null>(null);
  const [notice, setNotice] = useState<{type:"ok"|"error",text:string}|null>(null);
  const [masterEmail, setMasterEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [multiEmail, setMultiEmail] = useState("");
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [editingMultiKey, setEditingMultiKey] = useState("");
  const [registeredNode, setRegisteredNode] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [registeredEmails, setRegisteredEmails] = useState<string[]>([]);
  const [clientPasswords, setClientPasswords] = useState<Record<string,string>>({});
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string,boolean>>({});
  const [additional, setAdditional] = useState<any>({codigo:"",password:"",identificacion:"",nombre:"",ciudad:"",chat:"no",habilitarLogo:"no",habilitarNombreComercial:"no",habilitarPanicoPorVoz:"no",tipoPlan:"",valorPlan:"",emails:"0",fecha:"",initialAddress:"",initialLat:"",initialLng:""});
  const [planSearch, setPlanSearch] = useState("");
  const [planPage, setPlanPage] = useState(1);
  const planPageSize = 10;
  const [remindingKey, setRemindingKey] = useState("");

  const flash = (text:string, type:"ok"|"error"="ok") => {
    setNotice({text,type});
    window.setTimeout(()=>setNotice(null), 4500);
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, user => {
      if (!user) router.replace("/master/login");
      else setChecking(false);
    });
    const unsubClients = onValue(ref(db,"clients"), snap => {
      const rows: ClientRow[] = [];
      const all = snap.val() || {};
      Object.entries<any>(all).forEach(([codigo, client]) => {
        const perfil = client?.perfil || {};
        Object.entries<any>(perfil).forEach(([identificacion, wrap]) => {
          if (wrap?.datos) rows.push({...wrap.datos, rowKey:`${codigo}__${identificacion}`, codigoCliente: codigo, identificacion});
        });
      });
      setClients(rows);
    });
    const unsubMasters = onValue(ref(db,"maestro"), snap => {
      const data = snap.val() || {};
      setMasters(Object.entries<any>(data).map(([key,v])=>({key,email:v?.email||""})));
    });
    const unsubMulti = onValue(ref(db,"multiNodos"), snap => {
      const data = snap.val() || {};
      setMultiNodes(Object.entries<any>(data).map(([key,v])=>({key,email:v?.email||displayAllowedKey(key),nodos:Object.keys(v?.nodos||{}).filter(n=>v.nodos[n]),playerIds:v?.playerIds||{}})));
    });
    const test = ref(db, `status-check-write/${Date.now()}`);
    set(test,true).then(()=>remove(test)).then(()=>setFirebaseStatus("Conectado")).catch(()=>setFirebaseStatus("Error"));
    return () => { unsubAuth(); unsubClients(); unsubMasters(); unsubMulti(); };
  }, [router]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  }, [clients, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedClients = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const allowedEmails = useMemo(() => {
    const setEmails = new Set<string>();
    clients.forEach(r => { const e=clientEmail(r); if(e) setEmails.add(e.toLowerCase()); });
    return Array.from(setEmails).sort();
  }, [clients]);

  const planRows = useMemo<Array<ClientRow & { nombreCliente: string; emailCliente: string; daysRemaining: number | null }>>(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    return clients
      .filter(row => row.tipoPlan && row.fechaCulminacion)
      .map(row => {
        let daysRemaining: number | null = null;
        if (row.fechaCulminacion && row.fechaCulminacion !== "N/A") {
          const parts = String(row.fechaCulminacion).split("-").map(Number);
          if (parts.length === 3 && parts.every(Number.isFinite)) {
            const end = new Date(parts[0], parts[1]-1, parts[2]);
            end.setHours(0,0,0,0);
            if (!Number.isNaN(end.getTime())) {
              daysRemaining = Math.ceil((end.getTime() - today.getTime()) / 86400000);
            }
          }
        }
        return {
          ...row,
          nombreCliente: clientName(row),
          emailCliente: clientEmail(row) || "N/A",
          daysRemaining,
        };
      })
      .sort((a,b) => {
        const av = a.daysRemaining === null ? Number.MAX_SAFE_INTEGER : a.daysRemaining;
        const bv = b.daysRemaining === null ? Number.MAX_SAFE_INTEGER : b.daysRemaining;
        return av - bv;
      });
  }, [clients]);

  const filteredPlanRows = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return planRows;
    return planRows.filter(r =>
      [r.nombreCliente, r.emailCliente, r.tipoPlan, r.codigoCliente]
        .some(v => String(v || "").toLowerCase().includes(q))
    );
  }, [planRows, planSearch]);

  const planTotalPages = Math.max(1, Math.ceil(filteredPlanRows.length / planPageSize));
  const paginatedPlanRows = useMemo(
    () => filteredPlanRows.slice((planPage-1)*planPageSize, planPage*planPageSize),
    [filteredPlanRows, planPage]
  );

  useEffect(() => { setPlanPage(1); }, [planSearch]);
  useEffect(() => {
    if (planPage > planTotalPages) setPlanPage(planTotalPages);
  }, [planPage, planTotalPages]);

  const planStats = useMemo(() => ({
    total: planRows.length,
    vencidos: planRows.filter(r => r.tipoPlan !== "free" && r.daysRemaining !== null && r.daysRemaining < 0).length,
    proximos: planRows.filter(r => r.tipoPlan !== "free" && r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 30).length,
    free: planRows.filter(r => r.tipoPlan === "free").length,
  }), [planRows]);

  const setField = (key:string,value:any) => setForm((p:any)=>({...p,[key]:value}));

  const mapPreviewUrl = form.initialLat && form.initialLng
    ? `https://www.google.com/maps?q=${encodeURIComponent(form.initialLat)},${encodeURIComponent(form.initialLng)}&z=16&output=embed`
    : "";

  function openCreate() {
    setEditing(null); setForm(emptyClient); setLogoFile(null); setLogoPreview(""); setModal("client");
  }

  async function openEdit(row: ClientRow) {
    setEditing(row);
    setForm({
      clientType: row.tipo || "",
      nit: row.nit || "",
      codigoClienteEmpresa: row.codigoCliente || "",
      razonSocial: row.razonSocial || "",
      ciudadEmpresa: row.ciudad || "",
      telefonoEmpresa: row.telefonoContacto || "",
      emailEmpresa: row.email || "",
      direccionEmpresa: row.direccion || "",
      personaCargo: row.personaCargoProyecto || "",
      telefonoPersonaCargo: row.telefonoPersonaEncargada || "",
      cedula: row.cedula || "",
      codigoClientePersona: row.codigoCliente || "",
      nombresApellidos: row.nombresApellidos || "",
      celularPersona: row.celular || "",
      direccionPersona: row.direccionPersona || "",
      ciudadPersona: row.ciudadPersona || "",
      barrioPersona: row.barrio || "",
      emailPersona: row.emailPersona || "",
      tipoPlan: row.tipoPlan || "",
      valorPlan: row.valorPlan || "",
      emailsDisponibles: String(row.emailsDisponibles ?? 0),
      fechaActivacion: row.fechaActivacion || "",
      password: row.password || "",
      activarChat: row.chatActivado ? "si":"no",
      habilitarLogo: row.permitirLogo ? "si":"no",
      habilitarNombreComercial: row.permitirNombreComercial ? "si":"no",
      habilitarPanicoPorVoz: row.permitirPanicoPorVoz ? "si":"no",
      initialAddress: row.punto_inicial?.address || "",
      initialLat: row.punto_inicial?.lat || "",
      initialLng: row.punto_inicial?.lng || "",
    });
    setLogoPreview(row.logoUrl || "");
    setLogoFile(null);
    setModal("client");
  }

  async function geocodeAddress() {
    if (!form.initialAddress.trim()) return flash("Ingrese una dirección.","error");
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(form.initialAddress)}&components=country:CO&key=AIzaSyDRGfVr-bgjkZElihtyod1Xnr2-2qwT9ps`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === "OK" && data.results?.[0]) {
        const loc = data.results[0].geometry.location;
        setForm((p:any)=>({...p,initialLat:String(loc.lat),initialLng:String(loc.lng)}));
      } else flash("No se pudo encontrar la dirección.","error");
    } catch { flash("No fue posible consultar la ubicación.","error"); }
  }

  async function saveClient(e:FormEvent) {
    e.preventDefault();
    const codigo = form.clientType==="empresa" ? form.codigoClienteEmpresa.trim() : form.codigoClientePersona.trim();
    const identificacion = form.clientType==="empresa" ? form.nit.trim() : form.cedula.trim();
    const password = form.password.trim();
    if (!codigo || !identificacion || !password) return flash("Código de cliente, identificación y contraseña son obligatorios.","error");
    setBusy(true);
    try {
      const codeSnap = await get(ref(db,`clientCodes/${password}`));
      if (codeSnap.exists() && String(codeSnap.val()) !== codigo) throw new Error(`La contraseña "${password}" ya está asignada al cliente "${codeSnap.val()}".`);
      if (!editing) {
        const clientSnap = await get(ref(db,`clients/${codigo}`));
        if (clientSnap.exists()) throw new Error(`Ya existe el nodo clients/${codigo}.`);
      }
      let logoUrl = editing?.logoUrl || "";
      if (logoFile) {
        if (logoFile.size > 500*1024) throw new Error("El logo supera el límite de 500KB.");
        const sref = storageRef(storage,`logos/${codigo}/${identificacion}/${logoFile.name}`);
        await uploadBytes(sref,logoFile);
        logoUrl = await getDownloadURL(sref);
      }
      const planInfo:any = {
        tipoPlan:form.tipoPlan, valorPlan:form.valorPlan,
        emailsDisponibles:parseInt(form.emailsDisponibles||"0",10)||0,
        fechaActivacion:form.fechaActivacion,
        fechaCulminacion:completionDate(form.fechaActivacion,form.tipoPlan),
        password, chatActivado:form.activarChat==="si",
        permitirLogo:form.habilitarLogo==="si",
        permitirNombreComercial:form.habilitarNombreComercial==="si",
        permitirPanicoPorVoz:form.habilitarPanicoPorVoz==="si",
        punto_inicial:{address:form.initialAddress.trim(),lat:form.initialLat,lng:form.initialLng}
      };
      const data:any = form.clientType==="empresa" ? {
        tipo:"empresa",nit:identificacion,codigoCliente:codigo,razonSocial:form.razonSocial,
        ciudad:form.ciudadEmpresa,telefonoContacto:form.telefonoEmpresa,email:form.emailEmpresa,
        direccion:form.direccionEmpresa,personaCargoProyecto:form.personaCargo,
        telefonoPersonaEncargada:form.telefonoPersonaCargo,...planInfo
      } : {
        tipo:"persona",cedula:identificacion,codigoCliente:codigo,nombresApellidos:form.nombresApellidos,
        direccionPersona:form.direccionPersona,ciudadPersona:form.ciudadPersona,barrio:form.barrioPersona,
        celular:form.celularPersona,emailPersona:form.emailPersona,...planInfo
      };
      if (logoUrl) data.logoUrl=logoUrl;
      const updates:AnyData = {};
      updates[`clients/${codigo}/perfil/${identificacion}/datos`] = data;
      updates[`clients/${codigo}/notification_settings/button_assignments`] = {"ayuda":"alguienapoyo","general":"alarmagl","hurto":"sospechoso","protocolo":"protocolo"};
      updates[`clientCodes/${password}`] = codigo;
      if (editing && editing.password && editing.password !== password) updates[`clientCodes/${editing.password}`] = null;
      await update(ref(db),updates);
      flash(editing ? "Cliente actualizado exitosamente." : "Cliente creado exitosamente.");
      setModal(null);
    } catch(err:any) { flash(err?.message || "Error guardando el cliente.","error"); }
    finally { setBusy(false); }
  }

  async function toggleLock(row:ClientRow) {
    try {
      const next = row.estado==="bloqueado" ? "activo":"bloqueado";
      await update(ref(db,`clients/${row.codigoCliente}/perfil/${row.identificacion}/datos`),{estado:next});
      flash(next==="bloqueado" ? "Cliente bloqueado." : "Cliente activado.");
    } catch { flash("No se pudo cambiar el estado.","error"); }
  }

  async function deleteClient() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const fn = httpsCallable(functions,"deleteAllClientData");
      await fn({clientId:deleteTarget.codigoCliente,identificacion:deleteTarget.identificacion,password:deleteTarget.password,logoUrl:deleteTarget.logoUrl||null});
      flash("Cliente eliminado definitivamente.");
      setModal(null); setDeleteTarget(null);
    } catch(err:any) { flash(`No se pudo eliminar: ${err?.message||"error"}`,"error"); }
    finally { setBusy(false); }
  }

  async function sendAccess(row:ClientRow) {
    const email=clientEmail(row);
    if(!email) return flash("Este cliente no tiene email.","error");
    try {
      const emailjs = await import("@emailjs/browser");
      await emailjs.send("service_q456xmp","template_8eevqks",{
        to_email:email,
        client_name:clientName(row),
        client_code:row.codigoCliente,
        password:row.password,
        plan:row.tipoPlan,
        expiration:row.fechaCulminacion
      },{publicKey:"oXCLLxe0NLLCDRSrZ"});
      flash(`Datos enviados a ${email}.`);
    } catch(err:any) { flash(`Error enviando email: ${err?.message||"error"}`,"error"); }
  }

  async function sendRenewalReminder(row:any) {
    if (!row.emailCliente || row.emailCliente === "N/A" || !String(row.emailCliente).includes("@")) {
      return flash("No se puede enviar el recordatorio: el email del cliente no es válido o falta.","error");
    }
    const key = row.rowKey;
    setRemindingKey(key);
    try {
      const emailjs = await import("@emailjs/browser");
      let statusMessage = `tu plan '${row.tipoPlan}' está próximo a vencer.`;
      if (typeof row.daysRemaining === "number") {
        if (row.daysRemaining <= 0) statusMessage = `tu plan '${row.tipoPlan}' ha vencido.`;
        else if (row.daysRemaining === 1) statusMessage = `a tu plan '${row.tipoPlan}' le queda 1 día para vencer.`;
        else statusMessage = `a tu plan '${row.tipoPlan}' le quedan ${row.daysRemaining} días para vencer.`;
      }
      await emailjs.send("service_xtskmn9","template_3ybmru2",{
        to_name: row.nombreCliente,
        to_email: row.emailCliente,
        plan_type: row.tipoPlan,
        culmination_date: row.fechaCulminacion,
        plan_value: row.valorPlan || "0",
        status_message: statusMessage,
      },{publicKey:"oXCLLxe0NLLCDRSrZ"});
      flash(`Recordatorio de renovación enviado a ${row.emailCliente}.`);
    } catch(err:any) {
      flash(`Error al enviar recordatorio: ${err?.message || "error"}`,"error");
    } finally {
      setRemindingKey("");
    }
  }

  async function saveMaster(e:FormEvent) {
    e.preventDefault();
    if(!masterEmail || masterPassword.length<6) return flash("Email y contraseña de mínimo 6 caracteres son obligatorios.","error");
    setBusy(true);
    try {
      // Conserva el registro de maestro en RTDB. La creación segura en Authentication
      // debe hacerse con Admin SDK para no reemplazar la sesión del Master actual.
      const key=push(ref(db,"maestro")).key!;
      const updates:AnyData={};
      updates[`maestro/${key}`]={email:masterEmail};
      updates[`maestro_emails/${safeEmailKey(masterEmail)}`]=true;
      await update(ref(db),updates);
      flash("Email maestro registrado. La cuenta Authentication se conectará con Admin SDK.");
      setMasterEmail(""); setMasterPassword(""); setModal(null);
    } catch(err:any){ flash(err?.message||"Error creando maestro.","error"); }
    finally{setBusy(false);}
  }

  async function deleteMaster(key:string,email:string) {
    if(!confirm(`¿Eliminar ${email} de Emails Maestros?`)) return;
    const updates:AnyData={};
    updates[`maestro/${key}`]=null;
    updates[`maestro_emails/${safeEmailKey(email)}`]=null;
    await update(ref(db),updates);
    flash("Email maestro eliminado.");
  }

  function openMulti(row?:any) {
    setEditingMultiKey(row?.key||"");
    setMultiEmail(row?.email||"");
    setMultiSelected(row?.nodos||[]);
    setModal("multi");
  }

  async function saveMulti(e:FormEvent) {
    e.preventDefault();
    if(!multiEmail || !multiSelected.length) return flash("Seleccione email y al menos un nodo.","error");
    setBusy(true);
    try {
      const key=editingMultiKey || safeEmailKey(multiEmail);
      const nodos:AnyData={}; multiSelected.forEach(n=>nodos[n]=true);
      await set(ref(db,`multiNodos/${key}`),{email:multiEmail,nodos});
      if(editingMultiKey && editingMultiKey!==key) await remove(ref(db,`multiNodos/${editingMultiKey}`));
      flash("Asignación Multi Nodo guardada."); setModal(null);
    } catch(err:any){flash(err?.message||"Error guardando Multi Nodo.","error");}
    finally{setBusy(false);}
  }

  async function deleteMulti(row:any) {
    if(!confirm(`¿Eliminar asignación de ${row.email}?`)) return;
    await remove(ref(db,`multiNodos/${row.key}`)); flash("Asignación eliminada.");
  }

  async function assignPlayerIds(row:any) {
    setBusy(true);
    try {
      const ids:AnyData={};
      for(const nodo of row.nodos){
        const users=await get(ref(db,`clients/${nodo}/users`));
        const data=users.val()||{};
        Object.values<any>(data).forEach(u=>{
          const mail=(u?.email||"").toLowerCase();
          if(mail===row.email.toLowerCase()) Object.keys(u?.oneSignalPlayerIds||{}).forEach(id=>ids[id]=true);
        });
      }
      await update(ref(db,`multiNodos/${row.key}`),{playerIds:ids});
      flash(`${Object.keys(ids).length} Player ID(s) asociados.`);
    } catch{flash("No fue posible asignar Player IDs.","error");}
    finally{setBusy(false);}
  }

  async function loadRegisteredEmails(node:string) {
    setRegisteredNode(node); setRegisteredEmail(""); setRegisteredEmails([]);
    if(!node) return;
    const [allowedSnap, clientSnap] = await Promise.all([
      get(ref(db,`clients/${node}/allowedEmails`)),
      get(ref(db,`clients/${node}/perfil`))
    ]);
    const emailSet = new Set<string>();
    const allowed = allowedSnap.val()||{};
    Object.keys(allowed).filter(k=>allowed[k]===true).forEach(k=>{ const e=displayAllowedKey(k).trim().toLowerCase(); if(e.includes("@")) emailSet.add(e); });
    Object.values<any>(clientSnap.val()||{}).forEach(v=>{
      const d=v?.datos||{}; const e=String(d.tipo==="empresa"?d.email:d.emailPersona||"").trim().toLowerCase();
      if(e.includes("@")) emailSet.add(e);
    });
    const emails=Array.from(emailSet).sort((a,b)=>a.localeCompare(b));
    setRegisteredEmails(emails);
    if(emails.length) setRegisteredEmail(emails[0]);
  }

  async function geocodeAdditionalAddress() {
    if (!additional.initialAddress?.trim()) return flash("Ingrese una dirección para el nuevo nodo.","error");
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(additional.initialAddress)}&components=country:CO&key=AIzaSyDRGfVr-bgjkZElihtyod1Xnr2-2qwT9ps`;
      const res = await fetch(url); const data = await res.json();
      if (data.status === "OK" && data.results?.[0]) {
        const loc=data.results[0].geometry.location;
        setAdditional((p:any)=>({...p,initialLat:String(loc.lat),initialLng:String(loc.lng)}));
      } else flash("No se pudo encontrar la dirección.","error");
    } catch { flash("No fue posible consultar la ubicación.","error"); }
  }

  async function createAdditionalNode(e:FormEvent) {
    e.preventDefault();
    if(!registeredNode || !registeredEmail || !additional.codigo || !additional.password || !additional.identificacion) return flash("Complete los datos obligatorios.","error");
    setBusy(true);
    try {
      if((await get(ref(db,`clients/${additional.codigo}`))).exists()) throw new Error("El nuevo código de cliente ya existe.");
      if((await get(ref(db,`clientCodes/${additional.password}`))).exists()) throw new Error("La nueva contraseña ya existe.");
      const sourceRow=clients.find(c=>c.codigoCliente===registeredNode);
      const data:any={
        ...(sourceRow||{}),
        rowKey:undefined, identificacion:undefined,
        tipo:sourceRow?.tipo||"persona", codigoCliente:additional.codigo,
        ...(sourceRow?.tipo==="empresa"?{nit:additional.identificacion,razonSocial:additional.nombre,ciudad:additional.ciudad,email:registeredEmail}:{cedula:additional.identificacion,nombresApellidos:additional.nombre,ciudadPersona:additional.ciudad,emailPersona:registeredEmail}),
        tipoPlan:additional.tipoPlan,valorPlan:additional.valorPlan,emailsDisponibles:parseInt(additional.emails||"0")||0,
        fechaActivacion:additional.fecha,fechaCulminacion:completionDate(additional.fecha,additional.tipoPlan),
        password:additional.password,chatActivado:additional.chat==="si", estado:"activo",
        nodoAdicional:true,nodoOrigen:registeredNode,creadoDesdeGestionClientes:true,fechaCreacionNodoAdicional:new Date().toISOString(),
        punto_inicial:{address:String(additional.initialAddress||"").trim(),lat:String(additional.initialLat||""),lng:String(additional.initialLng||"")},
        permitirLogo:additional.habilitarLogo==="si", permitirNombreComercial:additional.habilitarNombreComercial==="si", permitirPanicoPorVoz:additional.habilitarPanicoPorVoz==="si",
      };
      delete data.rowKey; delete data.identificacion;
      const key=safeEmailKey(registeredEmail);
      const updates:AnyData={};
      updates[`clients/${additional.codigo}/perfil/${additional.identificacion}/datos`]=data;
      updates[`clients/${additional.codigo}/notification_settings/button_assignments`]={"ayuda":"alguienapoyo","general":"alarmagl","hurto":"sospechoso","protocolo":"protocolo"};
      updates[`clients/${additional.codigo}/allowedEmails/${key}`]=true;
      updates[`clients/${registeredNode}/allowedEmails/${key}`]=true;
      updates[`clientCodes/${additional.password}`]=additional.codigo;
      updates[`multiNodos/${key}/email`]=registeredEmail;
      updates[`multiNodos/${key}/nodos/${registeredNode}`]=true;
      updates[`multiNodos/${key}/nodos/${additional.codigo}`]=true;
      await update(ref(db),updates);
      flash("Nodo padre adicional creado."); setModal(null);
    } catch(err:any){flash(err?.message||"Error creando nodo.","error");}
    finally{setBusy(false);}
  }

  function daysLabel(row:any) {
    if (row.tipoPlan === "free" || row.daysRemaining === null) return "N/A";
    if (row.daysRemaining < 0) return `Vencido hace ${Math.abs(row.daysRemaining)} día(s)`;
    if (row.daysRemaining === 0) return "Vence hoy";
    return `${row.daysRemaining} día(s)`;
  }

  function planUrgency(row:any) {
    if (row.tipoPlan === "free" || row.daysRemaining === null) return "";
    if (row.daysRemaining <= 5) return styles.planRed;
    if (row.daysRemaining <= 15) return styles.planOrange;
    if (row.daysRemaining <= 30) return styles.planYellow;
    return "";
  }

  if(checking) return <main className={styles.loading}><span className={styles.spinner}/><p>Validando acceso maestro...</p></main>;

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><img src="/logo1.png" alt="Alerta Comunal" /></div>
          <div><strong>Alerta Comunal</strong><span>MASTER CONTROL</span></div>
        </div>
        <nav>
          <button className={tab==="clientes"?styles.active:""} onClick={()=>setTab("clientes")}><i>01</i><span>Clientes</span></button>
          <button className={tab==="multinodos"?styles.active:""} onClick={()=>setTab("multinodos")}><i>02</i><span>Multi Nodos</span></button>
          <button className={tab==="maestros"?styles.active:""} onClick={()=>setTab("maestros")}><i>03</i><span>Emails Maestros</span></button>
          <button className={tab==="planes"?styles.active:""} onClick={()=>setTab("planes")}><i>04</i><span>Planes</span></button>
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.service}><span className={firebaseStatus==="Conectado"?styles.online:styles.offline}/><div><b>Firebase</b><small>{firebaseStatus}</small></div></div>
          <button className={styles.logout} onClick={async()=>{await signOut(auth);router.replace("/master/login")}}>Cerrar sesión</button>
        </div>
      </aside>

      <section className={styles.content}>
        <header className={styles.topbar}>
          <div><span className={styles.kicker}>CONSOLA ADMINISTRATIVA</span><h1>{tab==="clientes"?"Gestión de Clientes":tab==="multinodos"?"Gestión de Multi Nodos":tab==="maestros"?"Emails Maestros":"Planes y Vencimientos"}</h1></div>
          <div className={styles.headerActions}>
            {tab==="clientes" && <button className={styles.primary} onClick={()=>setModal("choice")}>+ Cliente nuevo</button>}
            {tab==="multinodos" && <button className={styles.primary} onClick={()=>openMulti()}>+ Asignar nodos</button>}
            {tab==="maestros" && <button className={styles.primary} onClick={()=>setModal("master")}>+ Email maestro</button>}
          </div>
        </header>

        {notice && <div className={`${styles.notice} ${notice.type==="error"?styles.noticeError:""}`}>{notice.text}</div>}

        {tab==="clientes" && <>
          <div className={styles.metrics}>
            <Metric label="Clientes / nodos" value={clients.length}/>
            <Metric label="Activos" value={clients.filter(c=>statusFor(c).tone==="success").length}/>
            <Metric label="Bloqueados" value={clients.filter(c=>c.estado==="bloqueado").length}/>
            <Metric label="Multi Nodos" value={multiNodes.length}/>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}><div><h2>Directorio de clientes</h2><p>Información contractual, acceso y configuración de cada comunidad.</p></div><input className={styles.search} placeholder="Buscar cliente, ciudad, email..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Comunidad</th><th>Cliente</th><th>Plan</th><th>Estado</th><th>Chat</th><th>Logo</th><th>Nombre comercial</th><th>Emails</th><th>Contraseña</th><th>Acciones</th></tr></thead>
            <tbody>{paginatedClients.map(row=>{const st=statusFor(row);return <tr key={row.rowKey}>
              <td><strong>{row.codigoCliente}</strong><small>{row.ciudad||row.ciudadPersona||"Sin ciudad"}</small></td>
              <td>{clientName(row)}<small>{clientEmail(row)||"Sin email"}</small></td>
              <td><span className={styles.plan}>{row.tipoPlan||"N/A"}</span><small>{row.fechaCulminacion||"N/A"}</small></td>
              <td><span className={`${styles.status} ${styles[st.tone]}`}>{st.text}</span></td>
              <td><Bool value={!!row.chatActivado}/></td><td><Bool value={!!row.permitirLogo}/></td><td><Bool value={!!row.permitirNombreComercial}/></td>
              <td>{row.emailsDisponibles??0}</td>
              <td><div className={styles.passwordCell}><code>{visiblePasswords[row.codigoCliente] ? (clientPasswords[row.codigoCliente]||row.password||"—") : "••••••••"}</code><button type="button" className={styles.eyeBtn} title={visiblePasswords[row.codigoCliente]?"Ocultar contraseña":"Mostrar contraseña"} onClick={()=>setVisiblePasswords(p=>({...p,[row.codigoCliente]:!p[row.codigoCliente]}))}>{visiblePasswords[row.codigoCliente]?"Ocultar":"Ver"}</button></div></td>
              <td><div className={styles.actions}><button onClick={()=>openEdit(row)}>Editar</button><button onClick={()=>sendAccess(row)}>Email</button><button onClick={()=>toggleLock(row)}>{row.estado==="bloqueado"?"Activar":"Bloquear"}</button><button className={styles.dangerBtn} onClick={()=>{setDeleteTarget(row);setModal("delete")}}>Eliminar</button></div></td>
            </tr>})}{!filtered.length&&<tr><td colSpan={10} className={styles.empty}>No hay clientes para mostrar.</td></tr>}</tbody></table></div>
            <div className={styles.pagination}>
              <span>Mostrando {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} de {filtered.length}</span>
              <div>
                <button disabled={currentPage === 1} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))}>Anterior</button>
                {Array.from({length: totalPages}, (_,i)=>i+1)
                  .filter(n => n === 1 || n === totalPages || Math.abs(n-currentPage) <= 1)
                  .map((n,idx,arr)=><span key={n}>
                    {idx>0 && n-arr[idx-1]>1 && <i>…</i>}
                    <button className={n===currentPage?styles.pageActive:""} onClick={()=>setCurrentPage(n)}>{n}</button>
                  </span>)}
                <button disabled={currentPage === totalPages} onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))}>Siguiente</button>
              </div>
            </div>
          </div>
        </>}

        {tab==="multinodos" && <div className={styles.panel}><div className={styles.panelHead}><div><h2>Asignaciones Multi Nodo</h2><p>Emails con acceso a uno o varios nodos y sus Player IDs.</p></div></div><div className={styles.tableWrap}><table><thead><tr><th>Email</th><th>Nodos asignados</th><th>Player IDs</th><th>Acciones</th></tr></thead><tbody>{multiNodes.map(r=><tr key={r.key}><td><strong>{r.email}</strong></td><td><div className={styles.chips}>{r.nodos.map((n:string)=><span key={n}>{n}</span>)}</div></td><td>{Object.keys(r.playerIds||{}).length}</td><td><div className={styles.actions}><button onClick={()=>assignPlayerIds(r)}>Asignar IDs</button><button onClick={()=>openMulti(r)}>Editar</button><button className={styles.dangerBtn} onClick={()=>deleteMulti(r)}>Eliminar</button></div></td></tr>)}</tbody></table></div></div>}

        {tab==="maestros" && <div className={styles.panel}><div className={styles.panelHead}><div><h2>Usuarios maestros</h2><p>Correos autorizados para administración maestra.</p></div></div><div className={styles.tableWrap}><table><thead><tr><th>Email</th><th>Acciones</th></tr></thead><tbody>{masters.map(m=><tr key={m.key}><td><strong>{m.email}</strong></td><td><button className={styles.dangerBtn} onClick={()=>deleteMaster(m.key,m.email)}>Eliminar</button></td></tr>)}</tbody></table></div></div>}

        {tab==="planes" && <>
          <div className={styles.metrics}>
            <Metric label="Suscripciones" value={planStats.total}/>
            <Metric label="Próximos 30 días" value={planStats.proximos}/>
            <Metric label="Vencidos" value={planStats.vencidos}/>
            <Metric label="Planes Free" value={planStats.free}/>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Estado de Suscripciones de Clientes</h2>
                <p>Control de activación, vencimientos y recordatorios de renovación.</p>
              </div>
              <input className={styles.search} placeholder="Buscar cliente, email, plan..." value={planSearch} onChange={e=>setPlanSearch(e.target.value)}/>
            </div>
            <div className={styles.planLegend}>
              <span><i className={styles.legendYellow}/> 16–30 días</span>
              <span><i className={styles.legendOrange}/> 6–15 días</span>
              <span><i className={styles.legendRed}/> 5 días o menos / vencido</span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Cliente</th><th>Email Cliente</th><th>Tipo de Plan</th><th>Valor del Plan</th><th>Fecha de Activación</th><th>Fecha de Culminación</th><th>Días Restantes</th><th>Acciones</th></tr></thead>
                <tbody>
                  {paginatedPlanRows.map(row=><tr key={row.rowKey} className={planUrgency(row)}>
                    <td><strong>{row.nombreCliente}</strong><small>{row.codigoCliente}</small></td>
                    <td>{row.emailCliente}</td>
                    <td><span className={styles.plan}>{row.tipoPlan || "N/A"}</span></td>
                    <td>{row.valorPlan && row.valorPlan !== "0" ? `$${row.valorPlan}` : "N/A"}</td>
                    <td>{row.fechaActivacion || "N/A"}</td>
                    <td>{row.fechaCulminacion || "N/A"}</td>
                    <td><strong>{daysLabel(row)}</strong></td>
                    <td>{row.tipoPlan !== "free" && row.emailCliente !== "N/A" && row.daysRemaining !== null
                      ? <button className={styles.reminderBtn} disabled={remindingKey===row.rowKey} onClick={()=>sendRenewalReminder(row)}>{remindingKey===row.rowKey?"Enviando...":"Recordar"}</button>
                      : <span className={styles.muted}>—</span>}
                    </td>
                  </tr>)}
                  {!filteredPlanRows.length && <tr><td colSpan={8} className={styles.empty}>No hay suscripciones para mostrar.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className={styles.pagination}>
              <span>Mostrando {filteredPlanRows.length ? (planPage-1)*planPageSize+1 : 0}–{Math.min(planPage*planPageSize,filteredPlanRows.length)} de {filteredPlanRows.length}</span>
              <div>
                <button disabled={planPage===1} onClick={()=>setPlanPage(p=>Math.max(1,p-1))}>Anterior</button>
                {Array.from({length:planTotalPages},(_,i)=>i+1)
                  .filter(n=>n===1||n===planTotalPages||Math.abs(n-planPage)<=1)
                  .map((n,idx,arr)=><span key={n}>{idx>0&&n-arr[idx-1]>1&&<i>…</i>}<button className={n===planPage?styles.pageActive:""} onClick={()=>setPlanPage(n)}>{n}</button></span>)}
                <button disabled={planPage===planTotalPages} onClick={()=>setPlanPage(p=>Math.min(planTotalPages,p+1))}>Siguiente</button>
              </div>
            </div>
          </div>
        </>}
      </section>

      {modal && <div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setModal(null)}}>
        <div className={`${styles.modal} ${(modal==="client"||modal==="additional")?styles.modalWide:""}`}>
          {modal==="choice" && <><ModalHead title="Nuevo cliente" subtitle="Seleccione el tipo de operación" close={()=>setModal(null)}/><div className={styles.choiceGrid}><button onClick={openCreate}><b>+</b><strong>Crear cliente nuevo</strong><span>Registrar una nueva comunidad desde cero.</span></button><button onClick={()=>setModal("additional")}><b>↗</b><strong>Crear nodo padre adicional</strong><span>Partir de un usuario o comunidad ya registrada.</span></button></div></>}
          {modal==="client" && <form onSubmit={saveClient}><ModalHead title={editing?"Editar cliente":"Crear cliente"} subtitle="Perfil, plan, permisos y acceso de la comunidad" close={()=>setModal(null)}/><div className={styles.modalBody}>
            <Section title="Tipo de cliente y funcionalidades"><div className={styles.featuresGrid}>
              <Field label="Empresa / Persona natural"><select value={form.clientType} onChange={e=>setField("clientType",e.target.value)} required disabled={!!editing}><option value="">Seleccione...</option><option value="empresa">Empresa</option><option value="persona">Persona natural</option></select></Field>
              <div className={styles.featurePermission}><Field label="Habilitar Logo"><select value={form.habilitarLogo} onChange={e=>setField("habilitarLogo",e.target.value)}><option value="no">No</option><option value="si">Sí</option></select><small>Personalización del logo.</small></Field></div>
              <div className={styles.featurePermission}><Field label="Habilitar Nombre Comercial"><select value={form.habilitarNombreComercial} onChange={e=>setField("habilitarNombreComercial",e.target.value)}><option value="no">No</option><option value="si">Sí</option></select><small>Nombre comercial propio.</small></Field></div>
              <div className={`${styles.featurePermission} ${styles.voicePanicPermission}`}><Field label="Habilitar Pánico por Voz"><select value={form.habilitarPanicoPorVoz} onChange={e=>setField("habilitarPanicoPorVoz",e.target.value)}><option value="no">No</option><option value="si">Sí</option></select><small>Autoriza esta función para el nodo.</small></Field></div>
            </div></Section>
            {form.clientType==="empresa" && <Section title="Datos de empresa"><Grid>
              <Input label="NIT" value={form.nit} set={v=>setField("nit",v)} required/><Input label="Código de cliente" value={form.codigoClienteEmpresa} set={v=>setField("codigoClienteEmpresa",v)} required disabled={!!editing}/>
              <Input label="Razón social" value={form.razonSocial} set={v=>setField("razonSocial",v)}/><Input label="Ciudad" value={form.ciudadEmpresa} set={v=>setField("ciudadEmpresa",v)}/>
              <Input label="Teléfono contacto" value={form.telefonoEmpresa} set={v=>setField("telefonoEmpresa",v)}/><Input label="Email" type="email" value={form.emailEmpresa} set={v=>setField("emailEmpresa",v)}/>
              <Input label="Dirección" value={form.direccionEmpresa} set={v=>setField("direccionEmpresa",v)}/><Input label="Persona a cargo" value={form.personaCargo} set={v=>setField("personaCargo",v)}/><Input label="Teléfono encargado" value={form.telefonoPersonaCargo} set={v=>setField("telefonoPersonaCargo",v)}/>
            </Grid></Section>}
            {form.clientType==="persona" && <Section title="Datos de persona"><Grid>
              <Input label="Cédula" value={form.cedula} set={v=>setField("cedula",v)} required/><Input label="Código de cliente" value={form.codigoClientePersona} set={v=>setField("codigoClientePersona",v)} required disabled={!!editing}/>
              <Input label="Nombres y apellidos" value={form.nombresApellidos} set={v=>setField("nombresApellidos",v)}/><Input label="Celular" value={form.celularPersona} set={v=>setField("celularPersona",v)}/>
              <Input label="Dirección" value={form.direccionPersona} set={v=>setField("direccionPersona",v)}/><Input label="Ciudad" value={form.ciudadPersona} set={v=>setField("ciudadPersona",v)}/>
              <Input label="Barrio" value={form.barrioPersona} set={v=>setField("barrioPersona",v)}/><Input label="Email" type="email" value={form.emailPersona} set={v=>setField("emailPersona",v)}/>
            </Grid></Section>}
            <Section title="Información del plan"><Grid>
              <Field label="Tipo de plan"><select value={form.tipoPlan} onChange={e=>setField("tipoPlan",e.target.value)}><option value="">Seleccione...</option><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="free">Free</option></select></Field>
              <Input label="Valor del plan" type="number" value={form.valorPlan} set={v=>setField("valorPlan",v)}/><Input label="Emails disponibles" type="number" value={form.emailsDisponibles} set={v=>setField("emailsDisponibles",v)}/>
              <Input label="Fecha de activación" type="date" value={form.fechaActivacion} set={v=>setField("fechaActivacion",v)}/><Input label="Contraseña" value={form.password} set={v=>setField("password",v)} required/>
              <Field label="Habilitar Chat"><select value={form.activarChat} onChange={e=>setField("activarChat",e.target.value)}><option value="no">No</option><option value="si">Sí</option></select></Field>

            </Grid></Section>
            <Section title="Ubicación inicial"><Grid><Input label="Dirección inicial" value={form.initialAddress} set={v=>setField("initialAddress",v)}/><Field label="Geocodificación"><button type="button" className={styles.secondary} onClick={geocodeAddress}>Obtener coordenadas</button></Field><Input label="Latitud" value={form.initialLat} set={v=>setField("initialLat",v)}/><Input label="Longitud" value={form.initialLng} set={v=>setField("initialLng",v)}/></Grid>{mapPreviewUrl && <div className={styles.mapBox}><iframe title="Ubicación inicial del cliente" src={mapPreviewUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>}</Section>
            <Section title="Logo del cliente"><p className={styles.sectionNote}>Puedes asignar el logo inicial del cliente desde Master. Si “Habilitar Logo” está activo, el cliente también podrá modificarlo desde su Admin Web.</p><Field label="Logo (máx. 500KB)"><input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0]||null;setLogoFile(f);if(f)setLogoPreview(URL.createObjectURL(f))}}/>{logoPreview&&<img className={styles.logoPreview} src={logoPreview} alt="Logo"/>}</Field></Section>
          </div><ModalFoot busy={busy} close={()=>setModal(null)} text={editing?"Guardar cambios":"Guardar cliente"}/></form>}

          {modal==="delete" && <><ModalHead title="Eliminar cliente" subtitle="Esta operación es irreversible" close={()=>setModal(null)}/><div className={styles.modalBody}><div className={styles.deleteBox}>Se eliminarán el perfil, usuarios del cliente, código/contraseña de acceso y datos relacionados de <strong>{deleteTarget&&clientName(deleteTarget)}</strong>.</div></div><div className={styles.modalFoot}><button className={styles.secondary} onClick={()=>setModal(null)}>Cancelar</button><button className={styles.deleteConfirm} disabled={busy} onClick={deleteClient}>{busy?"Eliminando...":"Eliminar definitivamente"}</button></div></>}

          {modal==="master" && <form onSubmit={saveMaster}><ModalHead title="Nuevo Email Maestro" subtitle="Autoriza un nuevo administrador maestro" close={()=>setModal(null)}/><div className={styles.modalBody}><Grid><Input label="Correo electrónico" type="email" value={masterEmail} set={setMasterEmail} required/><Input label="Contraseña inicial" type="password" value={masterPassword} set={setMasterPassword} required/></Grid><p className={styles.info}>El registro RTDB se conserva. La creación segura en Firebase Authentication la conectaremos mediante Admin SDK para no sustituir la sesión del Master actual.</p></div><ModalFoot busy={busy} close={()=>setModal(null)} text="Guardar Email"/></form>}

          {modal==="multi" && <form onSubmit={saveMulti}><ModalHead title={editingMultiKey?"Editar Multi Nodo":"Asignar Multi Nodos"} subtitle="Vincula un email con una o varias comunidades" close={()=>setModal(null)}/><div className={styles.modalBody}><Field label="Email"><input list="emailsList" value={multiEmail} onChange={e=>setMultiEmail(e.target.value)} required/><datalist id="emailsList">{allowedEmails.map(e=><option key={e} value={e}/>)}</datalist></Field><Field label="Nodos"><div className={styles.nodePicker}>{Array.from(new Set(clients.map(c=>c.codigoCliente))).sort().map(n=><label key={n}><input type="checkbox" checked={multiSelected.includes(n)} onChange={e=>setMultiSelected(p=>e.target.checked?[...p,n]:p.filter(x=>x!==n))}/><span>{n}</span></label>)}</div></Field></div><ModalFoot busy={busy} close={()=>setModal(null)} text="Guardar asignación"/></form>}

          {modal==="additional" && <form onSubmit={createAdditionalNode}><ModalHead title="Crear Nodo Padre Adicional" subtitle="Crea otro nodo para un email ya registrado sin modificar el nodo actual" close={()=>setModal(null)}/><div className={styles.modalBody}>
            <Section title="Origen"><Grid><Field label="Comunidad / nodo padre"><select value={registeredNode} onChange={e=>loadRegisteredEmails(e.target.value)} required><option value="">Seleccione...</option>{Array.from(new Set(clients.map(c=>c.codigoCliente))).sort().map(n=><option key={n}>{n}</option>)}</select></Field><Field label="Email propietario / multinodo"><select value={registeredEmail} onChange={e=>setRegisteredEmail(e.target.value)} required><option value="">{registeredNode?"Seleccione un email permitido":"Seleccione primero una comunidad"}</option>{registeredEmails.map(e=><option key={e} value={e}>{e}</option>)}</select><small>{registeredNode && !registeredEmails.length?"Esta comunidad no tiene emails permitidos registrados.":`${registeredEmails.length} email(s) disponible(s)`}</small></Field></Grid></Section>
            <Section title="Nuevo nodo padre"><Grid><Input label="Nuevo código de cliente" value={additional.codigo} set={v=>setAdditional((p:any)=>({...p,codigo:v}))} required/><Input label="Nueva contraseña" value={additional.password} set={v=>setAdditional((p:any)=>({...p,password:v}))} required/><Input label="Identificación" value={additional.identificacion} set={v=>setAdditional((p:any)=>({...p,identificacion:v}))} required/><Input label="Nombre / razón social" value={additional.nombre} set={v=>setAdditional((p:any)=>({...p,nombre:v}))}/><Input label="Ciudad / zona" value={additional.ciudad} set={v=>setAdditional((p:any)=>({...p,ciudad:v}))}/><Field label="Habilitar Chat"><select value={additional.chat} onChange={e=>setAdditional((p:any)=>({...p,chat:e.target.value}))}><option value="no">No</option><option value="si">Sí</option></select></Field><Field label="Habilitar Logo"><select value={additional.habilitarLogo} onChange={e=>setAdditional((p:any)=>({...p,habilitarLogo:e.target.value}))}><option value="no">No</option><option value="si">Sí</option></select><small>Permite al nodo personalizar el logo desde su Admin Web.</small></Field><Field label="Habilitar Nombre Comercial"><select value={additional.habilitarNombreComercial} onChange={e=>setAdditional((p:any)=>({...p,habilitarNombreComercial:e.target.value}))}><option value="no">No</option><option value="si">Sí</option></select><small>Permite al nodo definir su nombre comercial.</small></Field></Grid></Section>
            <Section title="Ubicación inicial"><Grid><Input label="Dirección inicial" value={additional.initialAddress} set={v=>setAdditional((p:any)=>({...p,initialAddress:v}))}/><Field label="Geocodificación"><button type="button" className={styles.secondary} onClick={geocodeAdditionalAddress}>Obtener coordenadas</button></Field><Input label="Latitud" value={additional.initialLat} set={v=>setAdditional((p:any)=>({...p,initialLat:v}))}/><Input label="Longitud" value={additional.initialLng} set={v=>setAdditional((p:any)=>({...p,initialLng:v}))}/></Grid>{additional.initialLat && additional.initialLng && <div className={styles.mapBox}><iframe title="Ubicación inicial del nuevo nodo" src={`https://www.google.com/maps?q=${encodeURIComponent(additional.initialLat)},${encodeURIComponent(additional.initialLng)}&z=16&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>}</Section>
            <Section title="Plan"><Grid><Field label="Tipo"><select value={additional.tipoPlan} onChange={e=>setAdditional((p:any)=>({...p,tipoPlan:e.target.value}))}><option value="">Seleccione...</option><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="free">Free</option></select></Field><Input label="Valor" type="number" value={additional.valorPlan} set={v=>setAdditional((p:any)=>({...p,valorPlan:v}))}/><Input label="Emails" type="number" value={additional.emails} set={v=>setAdditional((p:any)=>({...p,emails:v}))}/><Input label="Activación" type="date" value={additional.fecha} set={v=>setAdditional((p:any)=>({...p,fecha:v}))}/></Grid></Section>
          </div><ModalFoot busy={busy} close={()=>setModal(null)} text="Crear nodo padre"/></form>}
        </div>
      </div>}
    </main>
  );
}

function Metric({label,value}:{label:string,value:number}){return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>}
function Bool({value}:{value:boolean}){return <span className={`${styles.bool} ${value?styles.yes:styles.no}`}>{value?"Sí":"No"}</span>}
function ModalHead({title,subtitle,close}:{title:string,subtitle:string,close:()=>void}){return <div className={styles.modalHead}><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" onClick={close}>×</button></div>}
function ModalFoot({busy,close,text}:{busy:boolean,close:()=>void,text:string}){return <div className={styles.modalFoot}><button type="button" className={styles.secondary} onClick={close}>Cancelar</button><button className={styles.primary} disabled={busy} type="submit">{busy?"Guardando...":text}</button></div>}
function Section({title,children}:{title:string,children:React.ReactNode}){return <section className={styles.formSection}><h3>{title}</h3>{children}</section>}
function Grid({children}:{children:React.ReactNode}){return <div className={styles.formGrid}>{children}</div>}
function Field({label,children}:{label:string,children:React.ReactNode}){return <label className={styles.field}><span>{label}</span>{children}</label>}
function Input({label,value,set,type="text",required=false,disabled=false}:{label:string,value:any,set:(v:string)=>void,type?:string,required?:boolean,disabled?:boolean}){return <Field label={label}><input type={type} value={value??""} onChange={e=>set(e.target.value)} required={required} disabled={disabled}/></Field>}

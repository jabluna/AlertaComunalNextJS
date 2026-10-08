"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import styles from "./login.module.css";

export default function MasterLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/master/dashboard");
      else setCheckingSession(false);
    });
    return unsubscribe;
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/master/dashboard");
    } catch (err: unknown) {
      console.error("Error de inicio de sesión:", err);
      setError("Credenciales incorrectas. Verifique el correo y la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <main className={styles.screen}>
        <div className={styles.ambientOne} />
        <div className={styles.ambientTwo} />
        <div className={styles.sessionLoader}>
          <span className={styles.loader} />
          <p>Verificando sesión segura...</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <div className={styles.grid} />
      <div className={styles.ambientOne} />
      <div className={styles.ambientTwo} />

      <section className={styles.shell}>
        <div className={styles.brandPanel}>
          <div className={styles.brandContent}>
            <div className={styles.logoFrame}>
              <Image
                src="/login.webp"
                alt="Alerta Comunal"
                width={230}
                height={230}
                priority
                className={styles.logo}
              />
            </div>

            <div className={styles.brandCopy}>
              <span className={styles.eyebrow}>PLATAFORMA CENTRAL</span>
              <h1>Alerta Comunal</h1>
              <p>
                Administración, control y gestión centralizada de la red.
              </p>
            </div>

            <div className={styles.status}>
              <span className={styles.statusDot} />
              <span>Sistema disponible</span>
            </div>
          </div>
        </div>

        <div className={styles.formPanel}>
          <div className={styles.formInner}>
            <div className={styles.mobileLogo}>
              <Image
                src="/login.webp"
                alt="Alerta Comunal"
                width={112}
                height={112}
                priority
                className={styles.logo}
              />
            </div>

            <div className={styles.heading}>
              <span className={styles.badge}>MASTER</span>
              <h2>Acceso Maestro</h2>
              <p>Ingresa tus credenciales para acceder al panel principal.</p>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="email">Correo electrónico</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M4 6.5h16v11H4z" />
                      <path d="m4.5 7 7.5 6 7.5-6" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nombre@ejemplo.com"
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="password">Contraseña</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <rect x="5" y="10" width="14" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ingresa tu contraseña"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className={styles.eyeButton}
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                        <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 5a17 17 0 0 1-2.1 2.7" />
                        <path d="M6.6 6.6C4.3 8 3 10 3 10s3.5 5 9 5c1.1 0 2.1-.2 3-.5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24">
                        <path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className={styles.error} role="alert">
                  <span>!</span>
                  {error}
                </div>
              )}

              <button className={styles.submit} type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <span className={styles.buttonLoader} />
                    Validando acceso...
                  </>
                ) : (
                  <>
                    Ingresar al panel
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            <div className={styles.secure}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 5 6v5c0 4.5 2.8 8.1 7 10 4.2-1.9 7-5.5 7-10V6l-7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <span>Acceso protegido y exclusivo para administración maestra</span>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        Alerta Comunal · Consola administrativa
      </footer>
    </main>
  );
}

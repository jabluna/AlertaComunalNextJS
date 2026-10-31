"use client";

import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "@/lib/firebase";

export type NodeLanguage = "es" | "it";

/** Idioma compartido por el nodo (español por defecto); se actualiza en tiempo real. */
export function useNodeLanguage(clientCode: string) {
  const [language, setLanguage] = useState<NodeLanguage>("es");

  useEffect(() => {
    setLanguage("es");
    if (!clientCode) return;
    return onValue(
      ref(db, `clients/${clientCode}/configuracion/idioma`),
      snapshot => {
        const next: NodeLanguage = snapshot.val() === "it" ? "it" : "es";
        setLanguage(next);
        document.documentElement.lang = next;
      },
      () => setLanguage("es")
    );
  }, [clientCode]);

  return {
    language,
    t: (es: string, it: string) => language === "it" ? it : es,
  };
}

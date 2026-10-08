"use client";

import { useEffect, useLayoutEffect } from "react";

const THEME_KEY = "alertaAdminTheme";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const syncTheme = () => {
    const saved = localStorage.getItem(THEME_KEY);
    const theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.adminTheme = theme;
    document.body.dataset.adminTheme = theme;
    document.documentElement.style.colorScheme = theme;
  };

  useLayoutEffect(() => {
    syncTheme();
  }, []);

  useEffect(() => {
    const onTheme = () => syncTheme();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === THEME_KEY) syncTheme();
    };
    window.addEventListener("alerta-admin-theme", onTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("alerta-admin-theme", onTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return children;
}

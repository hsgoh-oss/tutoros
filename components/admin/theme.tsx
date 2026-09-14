"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });
const THEME_KEY = "tutoros-admin-theme";

function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("admin-theme-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("admin-theme-change", onChange);
  };
}

export function AdminTheme({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const toggle = () => {
    try { localStorage.setItem(THEME_KEY, theme === "light" ? "dark" : "light"); }
    catch { return; }
    window.dispatchEvent(new Event("admin-theme-change"));
  };
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <div className="admin-surface" data-theme={theme}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function AdminThemeToggle() {
  const { theme, toggle } = useContext(ThemeContext);
  const label = theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환";
  return <button type="button" className="dash-icon-button" onClick={toggle} aria-label={label} title={label}>
    {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
  </button>;
}

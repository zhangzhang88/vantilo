import { createContext, useEffect, useState } from "react";

export const AppAppearanceContext = createContext<"light" | "sepia" | "green" | "dark">("light");

export function useSystemDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setDark(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return dark;
}

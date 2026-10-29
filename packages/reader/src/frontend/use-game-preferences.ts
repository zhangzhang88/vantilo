import { useContext, useState } from "react";
import { AppAppearanceContext } from "./appearance-context";
import { getReaderStorage } from "./reader-storage";
import { LEARNING_GAME_PREFERENCES_KEY, loadGamePreferences, type LearningGamePreferences } from "./learning-game-preferences";
export function useGamePreferences() {
  const [preferences,setPreferences] = useState(() => loadGamePreferences(getReaderStorage()));
  const appTheme = useContext(AppAppearanceContext);
  function changePreferences(patch: Partial<Omit<LearningGamePreferences,"version">>) {
    setPreferences(current => {
      const next = { ...current,...patch }; getReaderStorage().setItem(LEARNING_GAME_PREFERENCES_KEY,JSON.stringify(next)); return next;
    });
  }
  // Keep saved voices and legacy fields intact; appearance has one global source.
  return { preferences: { ...preferences, theme: "app" as const, background: "default" as const }, changePreferences, theme: appTheme };
}

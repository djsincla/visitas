import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ choice: 'dark', applied: 'dark', setChoice: () => {}, toggle: () => {} });
const STORAGE_KEY = 'visitas-theme';

function readInitial() {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return 'dark';
}

function systemPref() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [choice, setChoiceState] = useState(readInitial);
  const [systemTheme, setSystemTheme] = useState(systemPref);

  // React to OS-level theme changes when in auto mode.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const applied = choice === 'auto' ? systemTheme : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = applied;
    try { window.localStorage.setItem(STORAGE_KEY, choice); } catch {}
  }, [choice, applied]);

  const setChoice = (next) => {
    if (next !== 'light' && next !== 'dark' && next !== 'auto') return;
    setChoiceState(next);
  };

  // The topbar icon button cycles to an explicit value (auto → opposite of
  // current applied; light ↔ dark otherwise) so a single tap always feels
  // like "the other one".
  const toggle = () => {
    if (choice === 'auto') setChoiceState(applied === 'dark' ? 'light' : 'dark');
    else setChoiceState(choice === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ choice, applied, setChoice, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

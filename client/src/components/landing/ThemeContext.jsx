import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('landing-theme') || 'light'; } catch { return 'light'; }
  });
  const [spin, setSpin] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('landing-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setSpin(true);
    setTimeout(() => {
      setTheme((p) => (p === 'light' ? 'dark' : 'light'));
      setTimeout(() => setSpin(false), 350);
    }, 50);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, spin }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

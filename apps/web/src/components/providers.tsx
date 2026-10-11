"use client";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

const storageKey = "skimple.visitor-key.v1";
const VisitorContext = createContext<string | null>(null);

export const useVisitorKey = () => useContext(VisitorContext);

export function Providers({ children }: { children: ReactNode }) {
  const [visitorKey, setVisitorKey] = useState<string | null>(null);

  useEffect(() => {
    let key = window.localStorage.getItem(storageKey);
    if (!key || !/^[0-9a-f]{64}$/.test(key)) {
      key = Array.from(window.crypto.getRandomValues(new Uint8Array(32)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      window.localStorage.setItem(storageKey, key);
    }
    setVisitorKey(key);
  }, []);

  return (
    <VisitorContext.Provider value={visitorKey}>
      {children}
    </VisitorContext.Provider>
  );
}

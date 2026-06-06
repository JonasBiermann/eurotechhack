import { createContext, useContext, useState, type ReactNode } from 'react';
import { DICT, type Lang } from './dict';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string) => string;
  /** Pick the localized field from a bilingual object, e.g. L(district, 'name'). */
  L: (obj: any, base: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const t = (key: string) => DICT[key]?.[lang] ?? key;
  const L = (obj: any, base: string) => {
    if (!obj) return '';
    return obj[`${base}_${lang === 'en' ? 'en' : 'tc'}`] ?? obj[`${base}_en`] ?? '';
  };
  const toggle = () => setLang((l) => (l === 'en' ? 'zh' : 'en'));
  return <Ctx.Provider value={{ lang, setLang, toggle, t, L }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used within LanguageProvider');
  return ctx;
}

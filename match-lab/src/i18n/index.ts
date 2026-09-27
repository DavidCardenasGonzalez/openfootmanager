import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import ptBR from "./locales/pt-BR.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import it from "./locales/it.json";
import ru from "./locales/ru.json";
import zhCN from "./locales/zh-CN.json";
import cs from "./locales/cs.json";
import tr from "./locales/tr.json";
import id from "./locales/id.json";
import type { MatchEvent } from "../match/types";
export type Messages = typeof en;
export const languages = {
  en: "English",
  es: "Español",
  pt: "Português",
  "pt-BR": "Português (Brasil)",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  ru: "Русский",
  "zh-CN": "简体中文",
  cs: "Čeština",
  tr: "Türkçe",
  id: "Bahasa Indonesia",
};
export type Language = keyof typeof languages;
export const messages: Record<Language, Messages> = {
  en,
  es,
  pt,
  "pt-BR": ptBR,
  fr,
  de,
  it,
  ru,
  "zh-CN": zhCN,
  cs,
  tr,
  id,
};
export function eventLabel(event: MatchEvent | undefined, t: Messages) {
  return event ? t[event.kind === "reset" ? "resetEvent" : event.kind] : "—";
}

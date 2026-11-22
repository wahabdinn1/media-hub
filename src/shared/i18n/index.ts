import { enMessages, type MessageCatalog } from "./en";

export type SupportedLocale = "en";

const catalogs: Record<SupportedLocale, MessageCatalog> = {
  en: enMessages,
};

export function getMessages(locale: SupportedLocale = "en"): MessageCatalog {
  return catalogs[locale] ?? enMessages;
}

export function formatMessage(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

export { enMessages, type MessageCatalog };

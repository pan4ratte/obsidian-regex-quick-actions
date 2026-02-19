import { moment } from 'obsidian';
import en from './locales/en';

// Define a type based on the structure of your default language file
type LocaleMessages = typeof en;

const MESSAGES: Record<string, LocaleMessages> = {
    en: en,
};

const locale = moment.locale();

/**
 * Translates a key into the current locale string.
 * @param key - A valid key from the locale files
 * @param args - Values to replace '{}' placeholders in the string
 */
export const t = (key: keyof LocaleMessages, ...args: (string | number)[]): string => {
    const lang = MESSAGES[locale] ? locale : 'en';
    let text: string = MESSAGES[lang][key] || MESSAGES['en'][key];
    
    args.forEach(arg => {
        text = text.replace('{}', String(arg));
    });
    
    return text;
};
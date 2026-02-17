import { moment } from 'obsidian';
import en from './locales/en';
// import ru from './locales/ru'; // Import other languages here

const MESSAGES: { [key: string]: any } = {
    en: en,
    // ru: ru,
};

const locale = moment.locale();

export const t = (key: keyof typeof en, ...args: any[]): string => {
    const lang = MESSAGES[locale] ? locale : 'en';
    let text = MESSAGES[lang][key] || MESSAGES['en'][key];
    
    args.forEach(arg => {
        text = text.replace('{}', arg);
    });
    
    return text;
};
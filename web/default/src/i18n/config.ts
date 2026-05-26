/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ru from './locales/ru.json'
import vi from './locales/vi.json'
import zh from './locales/zh.json'
import enLocal from './locales/local-en.json'
import frLocal from './locales/local-fr.json'
import jaLocal from './locales/local-ja.json'
import ruLocal from './locales/local-ru.json'
import viLocal from './locales/local-vi.json'
import zhLocal from './locales/local-zh.json'

// Local fork: keys in `translation` come from upstream {lang}.json; keys in
// `local` come from local-{lang}.json. fallbackNS makes `t('foo')` look in
// `translation` first, then transparently fall through to `local`, so call
// sites stay unchanged.
export const resources = {
  en: { ...en, ...enLocal },
  zh: { ...zh, ...zhLocal },
  fr: { ...fr, ...frLocal },
  ru: { ...ru, ...ruLocal },
  ja: { ...ja, ...jaLocal },
  vi: { ...vi, ...viLocal },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh', 'fr', 'ru', 'ja', 'vi'],
    load: 'languageOnly', // Convert zh-CN -> zh
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    defaultNS: 'translation',
    fallbackNS: 'local',
    ns: ['translation', 'local'],
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n

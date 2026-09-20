const en = require('./en.json');
const sw = require('./sw.json');

const translations = { en, sw };

const t = (key, lang = 'sw', vars = {}) => {
  const l = translations[lang] || translations['sw'];
  let text = l[key] || translations['en'][key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v != null ? v : '');
  }
  return text;
};

module.exports = { t, translations };

// Speech recognition model choice per language. Parakeet TDT v3 covers 25 European
// languages with less memory and fuller punctuation; Nemotron 3.5 covers the rest
// (Vietnamese, Japanese, Korean, Hindi, Arabic, Mandarin, …) and detects the language.
// Locales from the nvidia/nemotron-3.5-asr-streaming-0.6b model card.
const LANGUAGES = [
  "en-US",
  "en-GB",
  "es-US",
  "es-ES",
  "fr-FR",
  "fr-CA",
  "it-IT",
  "pt-BR",
  "pt-PT",
  "nl-NL",
  "de-DE",
  "tr-TR",
  "ru-RU",
  "ar-AR",
  "hi-IN",
  "ja-JP",
  "ko-KR",
  "vi-VN",
  "uk-UA",
  "pl-PL",
  "sv-SE",
  "cs-CZ",
  "nb-NO",
  "da-DK",
  "bg-BG",
  "fi-FI",
  "hr-HR",
  "sk-SK",
  "zh-CN",
  "hu-HU",
  "ro-RO",
  "et-EE",
  "el-GR",
  "lt-LT",
  "lv-LV",
  "mt-MT",
  "sl-SI",
  "he-IL",
  "th-TH",
  "nn-NO",
];
const PARAKEET = new Set([
  "bg",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "de",
  "el",
  "hu",
  "it",
  "lv",
  "lt",
  "mt",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "es",
  "sv",
  "ru",
  "uk",
]);
const validLanguage = (code) => code === "auto" || LANGUAGES.includes(code);
// Engine arguments for one transcription pass. "auto" means detection found nothing,
// so Nemotron 3.5 identifies the language itself.
function recognizer(language) {
  return PARAKEET.has(language.split("-")[0])
    ? ["--model", "parakeet-tdt"]
    : ["--model", "nemotron-3.5", "--language", language];
}
module.exports = { LANGUAGES, validLanguage, recognizer };

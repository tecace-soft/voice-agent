/**
 * The language a call opens in.
 *
 * English is the default and almost always right, but not always: a consulate,
 * a community clinic, a business whose callers are its own diaspora. Those
 * callers should not have to ask for their language — the phone should already
 * be speaking it.
 *
 * This only sets the *opening*. Switching to whatever the caller actually
 * speaks is in the prompt regardless, so picking Korean does not shut English
 * out; it changes which language the receptionist starts in and falls back to.
 *
 * The prompts themselves stay in English. A model follows an English
 * instruction to speak Korean perfectly well, and an English prompt is one the
 * operator can still read and correct.
 *
 * The greeting is the exception and has to be written out, because
 * `spokenGreeting()` pulls the quoted line and sends it to be said aloud when
 * the model has not opened by itself. A translated-on-the-fly greeting is not
 * available at that moment.
 *
 * Pure data, like lib/use-cases.ts — a client component imports it.
 */

export type Language = {
  code: string;
  /** English name, for the admin picking it. */
  label: string;
  /** What its own speakers call it, for the prospect reading it. */
  native: string;
  /** How the receptionist opens. Quoted into the greeting prompt. */
  greeting: (business: string, agent: string) => string;
  /** How the receptionist ends a call. */
  signoff: (business: string) => string;
};

export const LANGUAGES: Language[] = [
  {
    code: "en",
    label: "English",
    native: "English",
    greeting: (b, a) => `Thanks for calling ${b}, this is ${a}! How can I help you today?`,
    signoff: (b) => `Thanks for calling ${b}, have a great day.`,
  },
  {
    code: "ko",
    label: "Korean",
    native: "한국어",
    greeting: (b, a) => `${b}입니다. 저는 ${a}입니다. 무엇을 도와드릴까요?`,
    signoff: (b) => `${b}에 전화 주셔서 감사합니다. 좋은 하루 보내세요.`,
  },
  {
    code: "es",
    label: "Spanish",
    native: "Español",
    greeting: (b, a) => `Gracias por llamar a ${b}, le atiende ${a}. ¿En qué puedo ayudarle?`,
    signoff: (b) => `Gracias por llamar a ${b}, que tenga un buen día.`,
  },
  {
    code: "zh",
    label: "Mandarin Chinese",
    native: "中文",
    greeting: (b, a) => `您好，这里是${b}，我是${a}。请问有什么可以帮您的吗？`,
    signoff: (b) => `感谢您致电${b}，祝您生活愉快。`,
  },
  {
    code: "ja",
    label: "Japanese",
    native: "日本語",
    greeting: (b, a) => `${b}でございます。${a}と申します。ご用件をお伺いいたします。`,
    signoff: (b) => `${b}にお電話いただきありがとうございました。失礼いたします。`,
  },
  {
    code: "vi",
    label: "Vietnamese",
    native: "Tiếng Việt",
    greeting: (b, a) =>
      `Cảm ơn quý khách đã gọi đến ${b}, tôi là ${a}. Tôi có thể giúp gì cho quý khách?`,
    signoff: (b) => `Cảm ơn quý khách đã gọi đến ${b}, chúc quý khách một ngày tốt lành.`,
  },
  {
    code: "fr",
    label: "French",
    native: "Français",
    greeting: (b, a) => `${b}, bonjour, ${a} à l'appareil. Que puis-je faire pour vous ?`,
    signoff: (b) => `Merci d'avoir appelé ${b}, bonne journée.`,
  },
  {
    code: "de",
    label: "German",
    native: "Deutsch",
    greeting: (b, a) => `${b}, guten Tag, hier ist ${a}. Was kann ich für Sie tun?`,
    signoff: (b) => `Vielen Dank für Ihren Anruf bei ${b}, einen schönen Tag noch.`,
  },
  {
    code: "pt",
    label: "Portuguese",
    native: "Português",
    greeting: (b, a) => `Obrigado por ligar para ${b}, aqui é ${a}. Em que posso ajudar?`,
    signoff: (b) => `Obrigado por ligar para ${b}, tenha um bom dia.`,
  },
  {
    code: "ru",
    label: "Russian",
    native: "Русский",
    greeting: (b, a) => `${b}, здравствуйте, меня зовут ${a}. Чем могу помочь?`,
    signoff: (b) => `Спасибо за звонок в ${b}, всего доброго.`,
  },
];

export const DEFAULT_LANGUAGE = "en";

/**
 * The language for a code, English for anything unrecognised. A record written
 * before this existed carries no code, and a demo that refuses to open because
 * nobody picked a language would be a strange thing to build.
 */
export function languageOf(code: string | undefined): Language {
  return (
    LANGUAGES.find((language) => language.code === code) ??
    LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE)!
  );
}

/** "Korean (한국어)", or just "English" where the two are the same word. */
export function languageName(code: string | undefined): string {
  const language = languageOf(code);
  return language.label === language.native
    ? language.label
    : `${language.label} (${language.native})`;
}

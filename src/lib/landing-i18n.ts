// Polish and German landing pages (sales report move 10, 2026-09-25).
//
// Poland and the German-speaking countries carve a lot of religious and
// hunting subjects and search in their own language ("droga krzyżowa stl",
// "hirsch relief stl"), where the English collection pages cannot rank. Each
// page here is a real landing page in that language: a native headline and
// introduction, sections of our best sellers for the subject, a short "how it
// works", payment facts and an FAQ. Product titles and the rest of the site stay
// English. Every page names its siblings (hreflang), and the English collection
// pages name them back, so Google shows each country its own version.
//
// Sections pull from the search index, so they fill themselves as designs are
// added. `q` is the English search that finds the designs; `seeAll` is the word
// in the page's language for the "see all" link (search-smart.ts translates it),
// so the searches Polish and German shoppers run are logged in their words.

export type Lang = 'pl' | 'de';
export type Section = { h: string; text: string; q: string; cats?: string[]; seeAll: string; limit?: number };
export type QA = { q: string; a: string };
export type Landing = {
  lang: Lang;
  slug: string;
  theme: 'religious' | 'wildlife';
  enPath: string;            // the English equivalent, for hreflang and the language link
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  lead: string;
  countCats: string[];       // collections counted in the stats line
  sections: Section[];
  faq: QA[];
};

/** Words the shared page template needs, per language. */
export const UI: Record<Lang, {
  count: (n: number) => string; seeAll: string; howH: string; how: string[]; factsH: string; facts: string[];
  faqH: string; freeH: string; freeText: string; freeCta: string; alsoIn: string; langName: string; requestText: string; requestCta: string;
}> = {
  pl: {
    count: (n) => `Projekty w kolekcji: ${n} · natychmiastowe pobranie · licencja komercyjna w cenie`,
    seeAll: 'Zobacz wszystkie',
    howH: 'Jak to działa',
    how: [
      'Wybierz projekt i dodaj go do koszyka. Konto nie jest potrzebne.',
      'Zapłać kartą, PayPalem, Apple Pay lub Google Pay. Link do pliku STL przychodzi e-mailem od razu po płatności.',
      'Otwórz plik w swoim programie CAM, ustaw rozmiar i głębokość, a potem frezuj, drukuj lub graweruj.',
    ],
    factsH: 'Dobrze wiedzieć',
    facts: [
      'Pliki STL działają z Vectric Aspire, VCarve Pro, Carveco, ArtCAM, Fusion i ze slicerami drukarek 3D.',
      'Model skalujesz do dowolnego rozmiaru, od małej tabliczki po duży panel.',
      'Ceny są w dolarach amerykańskich, bank przelicza je na złotówki. VAT nalicza Paddle, nasz partner płatniczy.',
      'Masz 14 dni na zwrot pieniędzy bez podawania przyczyny.',
    ],
    faqH: 'Najczęstsze pytania',
    freeH: '5 pełnych projektów za darmo',
    freeText: 'Sprawdź na własnej maszynie, jak frezują się nasze płaskorzeźby, zanim cokolwiek kupisz. To całe projekty, nie próbki.',
    freeCta: 'Odbierz darmowe pliki',
    alsoIn: 'Ta strona w innych językach:',
    langName: 'Polski',
    requestText: 'Nie ma motywu, którego szukasz?',
    requestCta: 'Zgłoś prośbę o projekt',
  },
  de: {
    count: (n) => `${n} Motive · sofortiger Download · gewerbliche Nutzung inklusive`,
    seeAll: 'Alle ansehen',
    howH: 'So funktioniert es',
    how: [
      'Motiv auswählen und in den Warenkorb legen. Ein Kundenkonto ist nicht nötig.',
      'Mit Karte, PayPal, Apple Pay oder Google Pay bezahlen. Der Download-Link zur STL-Datei kommt sofort per E-Mail.',
      'Datei in Ihrer CAM-Software öffnen, Größe und Tiefe einstellen und fräsen, drucken oder lasern.',
    ],
    factsH: 'Gut zu wissen',
    facts: [
      'Die STL-Dateien funktionieren mit Vectric Aspire, VCarve Pro, Carveco, ArtCAM, Fusion und jedem Slicer für 3D-Drucker.',
      'Jedes Modell lässt sich auf jede Größe skalieren, vom kleinen Schild bis zur großen Wandtafel.',
      'Die Preise stehen in US-Dollar, an der Kasse zahlen Sie in Euro. Die Mehrwertsteuer berechnet Paddle, unser Zahlungspartner, nach Ihrem Land.',
      '14 Tage Geld-zurück-Garantie, ohne Angabe von Gründen.',
    ],
    faqH: 'Häufige Fragen',
    freeH: '5 vollständige Motive gratis',
    freeText: 'Testen Sie auf Ihrer eigenen Maschine, wie sich unsere Reliefs fräsen lassen, bevor Sie etwas kaufen. Ganze Motive, keine Muster.',
    freeCta: 'Gratis-Dateien holen',
    alsoIn: 'Diese Seite in anderen Sprachen:',
    langName: 'Deutsch',
    requestText: 'Ihr Motiv ist nicht dabei?',
    requestCta: 'Motiv-Wunsch einreichen',
  },
};

const RELIGIOUS = ['religious-christian'];
const WILD = ['wildlife-wall-art-stl', 'hunting-lodge-decor', 'wild-boar-hog-wildlife', 'flying-ducks-owl-birds', 'fish-fly-fishing-stl'];

const FAQ_PL = (subject: string): QA[] => [
  { q: 'Z jakimi programami działają pliki?',
    a: 'Plik STL to siatka 3D. Otworzysz go w Vectric Aspire, VCarve Pro, Carveco, ArtCAM lub Fusion, a także w slicerze drukarki 3D. W programie ustawiasz rozmiar, głębokość i ścieżki narzędzia.' },
  { q: 'W jakim rozmiarze mogę wyfrezować projekt?',
    a: `W dowolnym, model skaluje się bez utraty proporcji. ${subject} najczęściej frezuje się w formacie od 300 do 600 mm. Przy małych formatach drobne detale wymagają cieńszego frezu kulowego. Przed zakupem możesz sprawdzić model w bezpłatnym narzędziu <a href="/tools/will-it-cut">Will it cut</a>.` },
  { q: 'Jak zapłacę i w jakiej walucie?',
    a: 'Ceny są w dolarach amerykańskich. Płacisz kartą, PayPalem, Apple Pay lub Google Pay przez Paddle, naszego partnera płatniczego, a Twój bank przelicza kwotę na złotówki. Paddle nalicza VAT według Twojego kraju i wysyła potwierdzenie zakupu.' },
  { q: 'Czy mogę sprzedawać wyfrezowane prace?',
    a: 'Tak. Licencja komercyjna jest w cenie każdego projektu: możesz sprzedawać gotowe przedmioty, które wyfrezujesz, wydrukujesz lub wygrawerujesz, bez dodatkowych opłat. Nie wolno udostępniać ani odsprzedawać samego pliku.' },
  { q: 'Jak dostanę plik i co, jeśli go zgubię?',
    a: 'Link do pobrania przychodzi e-mailem zaraz po płatności i zostaje na Twoim koncie. Ponowne pobranie jest zawsze bezpłatne. Masz też 14 dni na zwrot pieniędzy bez podawania przyczyny.' },
  { q: 'Strona jest po angielsku. Czy to problem?',
    a: 'Nie. Pliki STL nie zawierają tekstu, a koszyk i płatność działają jak w każdym sklepie internetowym. Z pytaniami pisz na <a href="mailto:jolly@digitalchiselco.com">jolly@digitalchiselco.com</a>.' },
];

const FAQ_DE = (subject: string): QA[] => [
  { q: 'Mit welcher Software funktionieren die Dateien?',
    a: 'Eine STL-Datei ist ein 3D-Netz. Sie öffnen sie in Vectric Aspire, VCarve Pro, Carveco, ArtCAM oder Fusion und in jedem Slicer für den 3D-Druck. Größe, Tiefe und Werkzeugwege legen Sie dort selbst fest.' },
  { q: 'In welcher Größe kann ich das Motiv fräsen?',
    a: `In jeder Größe, das Modell skaliert ohne Verzerrung. ${subject} werden meist zwischen 300 und 600 mm gefräst. Bei kleinen Formaten brauchen feine Details einen dünneren Kugelfräser. Vor dem Kauf können Sie das Modell mit unserem kostenlosen Werkzeug <a href="/tools/will-it-cut">Will it cut</a> prüfen.` },
  { q: 'Wie bezahle ich, und in welcher Währung?',
    a: 'Die Preise stehen in US-Dollar, an der Kasse zahlen Sie in Euro. Möglich sind Karte, PayPal, Apple Pay und Google Pay über Paddle, unseren Zahlungspartner. Paddle berechnet die Mehrwertsteuer nach Ihrem Land und schickt Ihnen die Rechnung.' },
  { q: 'Darf ich die gefrästen Stücke verkaufen?',
    a: 'Ja. Die gewerbliche Nutzung ist bei jedem Motiv inklusive: Sie dürfen alles verkaufen, was Sie daraus fräsen, drucken oder lasern, ohne Lizenzgebühr. Nicht erlaubt ist die Weitergabe oder der Weiterverkauf der Datei selbst.' },
  { q: 'Wie bekomme ich die Datei, und was, wenn ich sie verliere?',
    a: 'Der Download-Link kommt direkt nach der Zahlung per E-Mail und bleibt in Ihrem Kundenkonto. Erneutes Herunterladen ist immer kostenlos. Außerdem haben Sie 14 Tage Geld-zurück-Garantie ohne Angabe von Gründen.' },
  { q: 'Die Website ist auf Englisch. Ist das ein Problem?',
    a: 'Nein. STL-Dateien enthalten keinen Text, und Warenkorb und Kasse funktionieren wie in jedem Onlineshop. Fragen gerne an <a href="mailto:jolly@digitalchiselco.com">jolly@digitalchiselco.com</a>.' },
];

export const LANDINGS: Landing[] = [
  {
    lang: 'pl', slug: 'religijne-plaskorzezby-stl', theme: 'religious', enPath: '/collections/religious-christian',
    title: 'Płaskorzeźby religijne STL do CNC: Droga Krzyżowa, Ostatnia Wieczerza | DigitalChiselCo',
    description: 'Pliki STL płaskorzeźb religijnych do frezarki CNC i druku 3D: Ostatnia Wieczerza, Droga Krzyżowa, Jezus, Matka Boska. Natychmiastowe pobranie, licencja komercyjna.',
    eyebrow: 'Pliki STL do frezarki CNC i druku 3D',
    h1: 'Płaskorzeźby religijne STL do frezarki CNC',
    lead: 'Ostatnia Wieczerza, sceny Drogi Krzyżowej, Jezus i Matka Boska jako gotowe modele 3D. Plik STL pobierasz od razu po zakupie, skalujesz do potrzebnego rozmiaru i frezujesz w drewnie: na tablicę do kościoła lub kaplicy, do domu albo jako prezent na komunię, bierzmowanie czy ślub.',
    countCats: RELIGIOUS,
    sections: [
      { h: 'Ostatnia Wieczerza', q: 'last supper', seeAll: 'ostatnia wieczerza',
        text: 'Jeden z najchętniej kupowanych motywów w naszym sklepie. Pięknie wygląda nad stołem w jadalni i jako prezent ślubny.' },
      { h: 'Droga Krzyżowa', q: 'stations of the cross', seeAll: 'droga krzyżowa', limit: 16,
        text: 'Wszystkie 14 stacji Drogi Krzyżowej: każda jako osobna płaskorzeźba albo cały komplet w niższej cenie. Pasują do kościoła, kaplicy i domowego ołtarzyka.' },
      { h: 'Jezus Chrystus', q: 'jesus', seeAll: 'jezus',
        text: 'Oblicze Chrystusa, Ukrzyżowanie, Jezus uciszający burzę i inne sceny z Ewangelii.' },
      { h: 'Matka Boska i anioły', q: 'mary', seeAll: 'matka boska',
        text: 'Maryja, Pieta i sceny z aniołami, także na tablice pamiątkowe.' },
      { h: 'Najczęściej kupowane', q: '', cats: RELIGIOUS, seeAll: '', limit: 12,
        text: 'Wszystkie motywy religijne, od najlepiej sprzedających się.' },
    ],
    faq: FAQ_PL('Płaskorzeźby religijne'),
  },
  {
    lang: 'pl', slug: 'dzika-przyroda-plaskorzezby-stl', theme: 'wildlife', enPath: '/collections/wildlife-wall-art-stl',
    title: 'Płaskorzeźby STL dzika przyroda i motywy myśliwskie do CNC | DigitalChiselCo',
    description: 'Pliki STL do frezarki CNC i druku 3D: jeleń, dzik, wilk, niedźwiedź, kaczki i ryby. Motywy myśliwskie i wędkarskie, natychmiastowe pobranie, licencja komercyjna.',
    eyebrow: 'Pliki STL do frezarki CNC i druku 3D',
    h1: 'Dzika przyroda i motywy myśliwskie: płaskorzeźby STL',
    lead: 'Jelenie, dziki, wilki, niedźwiedzie, kaczki i ryby jako gotowe modele 3D do frezowania w drewnie. Idealne na ścianę domku myśliwskiego, do koła łowieckiego, na trofea i prezenty dla myśliwych oraz wędkarzy.',
    countCats: WILD,
    sections: [
      { h: 'Jeleń i sarna', q: 'deer', seeAll: 'jeleń',
        text: 'Byki na rykowisku, rodziny jeleni w górach i sceny leśne. Nasze najlepiej sprzedające się motywy.' },
      { h: 'Dzik', q: 'boar', seeAll: 'dzik',
        text: 'Odyniec w lesie, locha z warchlakami i sceny z polowania.' },
      { h: 'Wilk', q: 'wolf', seeAll: 'wilk', text: 'Wyjący wilk przy pełni księżyca, wilki w sosnowym lesie.' },
      { h: 'Niedźwiedź', q: 'bear', seeAll: 'niedźwiedź', text: 'Grizzly przy strumieniu, niedźwiedzica z młodymi.' },
      { h: 'Kaczki i ptactwo', q: 'duck', seeAll: 'kaczki', text: 'Krzyżówki w locie, bażanty i psy myśliwskie przy pracy.' },
      { h: 'Ryby i wędkarstwo', q: 'fish', seeAll: 'ryba', text: 'Szczupak, pstrąg, okoń i sceny wędkarskie.' },
    ],
    faq: FAQ_PL('Płaskorzeźby z dziką przyrodą'),
  },
  {
    lang: 'de', slug: 'religioese-reliefs-stl', theme: 'religious', enPath: '/collections/religious-christian',
    title: 'Religiöse Reliefs als STL für CNC: Kreuzweg, Abendmahl, Madonna | DigitalChiselCo',
    description: 'STL-Dateien religiöser Reliefs für CNC-Fräse und 3D-Druck: Das Letzte Abendmahl, Kreuzweg, Jesus Christus, Madonna. Sofortiger Download, gewerbliche Nutzung inklusive.',
    eyebrow: 'STL-Dateien für CNC-Fräse und 3D-Druck',
    h1: 'Religiöse Reliefs als STL-Datei für die CNC-Fräse',
    lead: 'Das Letzte Abendmahl, Stationen des Kreuzwegs, Christus und die Madonna als fertige 3D-Modelle. Sie laden die STL-Datei direkt nach dem Kauf herunter, skalieren sie auf die gewünschte Größe und fräsen sie in Holz: als Tafel für Kirche oder Kapelle, für das eigene Zuhause oder als Geschenk zu Kommunion, Firmung oder Hochzeit.',
    countCats: RELIGIOUS,
    sections: [
      { h: 'Das Letzte Abendmahl', q: 'last supper', seeAll: 'abendmahl',
        text: 'Eines unserer meistverkauften Motive. Wirkt besonders schön über dem Esstisch und als Hochzeitsgeschenk.' },
      { h: 'Kreuzweg', q: 'stations of the cross', seeAll: 'kreuzweg', limit: 16,
        text: 'Alle 14 Stationen des Kreuzwegs: jede als einzelnes Relief oder das komplette Set zum Vorteilspreis. Passend für Kirche, Kapelle und Hausaltar.' },
      { h: 'Jesus Christus', q: 'jesus', seeAll: 'jesus',
        text: 'Das Antlitz Christi, die Kreuzigung, die Stillung des Sturms und weitere Szenen aus den Evangelien.' },
      { h: 'Madonna und Engel', q: 'mary', seeAll: 'madonna',
        text: 'Maria, Pietà und Engelszenen, auch als Gedenktafel.' },
      { h: 'Meistverkauft', q: '', cats: RELIGIOUS, seeAll: '', limit: 12,
        text: 'Alle religiösen Motive, die beliebtesten zuerst.' },
    ],
    faq: FAQ_DE('Religiöse Reliefs'),
  },
  {
    lang: 'de', slug: 'wildtiere-jagd-reliefs-stl', theme: 'wildlife', enPath: '/collections/wildlife-wall-art-stl',
    title: 'Wildtiere und Jagdmotive als Relief-STL für CNC | DigitalChiselCo',
    description: 'STL-Dateien für CNC-Fräse und 3D-Druck: Hirsch, Wildschwein, Wolf, Bär, Enten und Fische. Jagd- und Anglermotive, sofortiger Download, gewerbliche Nutzung inklusive.',
    eyebrow: 'STL-Dateien für CNC-Fräse und 3D-Druck',
    h1: 'Wildtiere und Jagdmotive als Relief-STL',
    lead: 'Hirsch, Wildschwein, Wolf, Bär, Enten und Fische als fertige 3D-Modelle zum Fräsen in Holz. Wie gemacht für die Jagdhütte, den Hegering, Trophäenbretter und Geschenke für Jäger und Angler.',
    countCats: WILD,
    sections: [
      { h: 'Hirsch und Reh', q: 'deer', seeAll: 'hirsch',
        text: 'Röhrende Hirsche, Hirschfamilien im Gebirge und Waldszenen. Unsere meistverkauften Motive.' },
      { h: 'Wildschwein', q: 'boar', seeAll: 'wildschwein',
        text: 'Keiler im Wald, Bache mit Frischlingen und Jagdszenen.' },
      { h: 'Wolf', q: 'wolf', seeAll: 'wolf', text: 'Heulender Wolf vor dem Vollmond, Wölfe im Kiefernwald.' },
      { h: 'Bär', q: 'bear', seeAll: 'bear', text: 'Grizzly am Gebirgsbach, Bärin mit Jungen.' },
      { h: 'Enten und Federwild', q: 'duck', seeAll: 'enten', text: 'Stockenten im Flug, Fasanen und Jagdhunde bei der Arbeit.' },
      { h: 'Fische und Angeln', q: 'fish', seeAll: 'fisch', text: 'Hecht, Forelle, Barsch und Anglerszenen.' },
    ],
    faq: FAQ_DE('Wildtier-Reliefs'),
  },
];

export const landingPath = (l: Pick<Landing, 'lang' | 'slug'>) => `/${l.lang}/${l.slug}`;
export const landingFor = (lang: Lang, slug: string) => LANDINGS.find((l) => l.lang === lang && l.slug === slug) || null;

/** hreflang set for one theme: every language version plus English as the
 *  default. Used by the landing pages and by the English collection pages. */
export function themeAlternates(theme: Landing['theme']) {
  const ls = LANDINGS.filter((l) => l.theme === theme);
  const en = ls[0]?.enPath;
  return [
    ...ls.map((l) => ({ hreflang: l.lang, href: landingPath(l) })),
    ...(en ? [{ hreflang: 'en', href: en }, { hreflang: 'x-default', href: en }] : []),
  ];
}
/** The English collection slug -> theme, for the reverse hreflang links. */
export const THEME_BY_COLLECTION: Record<string, Landing['theme']> = {
  'religious-christian': 'religious',
  'wildlife-wall-art-stl': 'wildlife',
};

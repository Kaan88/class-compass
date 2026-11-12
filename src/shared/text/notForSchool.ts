/**
 * Real words that the larger word lists of the student text check never call "known" (S28b, D-198):
 * slurs and insults, sexual and vulgar words, and drug words that the language check (`riskyWords.ts`)
 * does not block. `npm run gen:word-lists` drops them from the generated lists, and `largeWords.ts`
 * passes them as the dictionary's `notKnown`, so a form made from one of them with endings or suffixes
 * ("hookers", "kerhanede") is not recognised through a shorter innocent word either ("hook" + "er").
 * A word that is not known is never refused for that alone; it only counts towards the unknown share.
 * Words with an everyday meaning stay known (crack, weed, strip, bone). Written folded (`foldForSearch`).
 *
 * Only `largeWords.ts` (the lazy chunk) and the generator import this file, never the student page's
 * first load. This is our own hand list, not a reviewed filter list: a person still has to read the
 * generated lists (ROADMAP).
 */
import { RISKY_EN, RISKY_TR } from './riskyWords.ts';
import { isRecognisedWord } from './textQuality.ts';
import { foldForSearch } from './turkish.ts';

const EN = `
  anal anus arousal bimbo blowjob boner booze brothel cannabis cocaine condom dildo drunkard erection genital genitals
  hardcore heroin homo horny incest junkie kinky marijuana nude nudity orgy pervert pimp scum semen sperm stripper
  testicle vulgar whore hooker bong cum dyke kike spic chink gook wop dago tranny coon jap paki queer nazi hell
  wetback redskin mulatto octoroon quadroon halfbreed gringo raghead towelhead honky darky squaw injun coolie yid kraut
  spastic spaz retard midget imbecile cretin moron gimp sissy fag faggot lesbo poofter shemale
  harlot floozy strumpet trollop hussy wench nymphomaniac sodomy sodomite rape molester clitoris vulva scrotum foreskin
  ejaculate ejaculation copulate copulation intercourse aphrodisiac bestiality voyeur lewd smut fetish striptease lingerie
  bondage sadist masochist lecher lechery lust lusty seduce seductive sensual raunchy sleazy playboy boob boobs buttock
  buttocks crotch turd crap crappy bugger buggery wank bollocks twat jizz
  hashish opium amphetamine methamphetamine narcotic narcotics crackhead pothead reefer
`;

const TR = `
  esrar eroin kokain prezervatif fahise genelev kerhane kevase surtuk kancik durzu deyyus yosma kaltak pezevenk zina
  ensest vajina travesti ibne cinsellik seks seksi sexy
  pust nonos kulampara oglanci godos gavat kahpe pic got bok boktan tasak sic osur osuruk esrarkes zampara gavur zenci
  sehvet gerizekali cinsel erotik orgazm kondom haspa bokla boke goden
`;

const folded = (list: string) =>
  list
    .split(/\s+/u)
    .filter(Boolean)
    .map((w) => foldForSearch(w));
export const NOT_FOR_SCHOOL_EN: ReadonlySet<string> = new Set(folded(EN));
export const NOT_FOR_SCHOOL_TR: ReadonlySet<string> = new Set(folded(TR));
export const NOT_FOR_SCHOOL: ReadonlySet<string> = new Set([...NOT_FOR_SCHOOL_EN, ...NOT_FOR_SCHOOL_TR]);

/**
 * The large dictionary's `notKnown` (D-198): `NOT_FOR_SCHOOL` and the folded spelling of every built-in
 * risky word of three or more letters (the language check matches some only unfolded: "puşt", not
 * "pust"), without the words our small lists recognise (so the large lists never know less than they do).
 */
export const NOT_KNOWN: ReadonlySet<string> = new Set(
  [...NOT_FOR_SCHOOL, ...[...RISKY_EN, ...RISKY_TR].map((e) => foldForSearch(e.w))].filter((w) => /^[a-z]{3,}$/u.test(w) && !isRecognisedWord(w)),
);

/**
 * Strings of Admin → School holidays (S25b, D-186): the holiday calendar of each school year. An area
 * dictionary (D-179): registered when the page is imported, so the student page never loads it (budget
 * D-151). The menu label, the classroom note and the report texts are in the staff dictionary; the
 * error reasons in the main one.
 */
import { registerMessages } from '../index.ts';

export const en = {
  'holidays.title': 'School holidays',
  'holidays.intro': 'Days without school in a school year: the semester break, national and religious holidays. Reports leave them out of every school-day count (they show “no school”, never 0 or “not recorded”), and the Daily Assistant has nobody on duty. A teacher can still start a lesson on a holiday, for a make-up lesson.',
  'holidays.year': 'School year',
  'holidays.noYears': 'There is no school year yet. Add one under School years and terms first.',
  'holidays.archived': 'This school year is archived, so its holidays can no longer be changed.',
  'holidays.add': 'Add a holiday',
  'holidays.edit': 'Change the holiday',
  'holidays.listCaption': 'Holidays of {year}',
  'holidays.none': 'No holidays yet. Every Monday to Friday of the year counts as a school day.',
  'holidays.col.name': 'Name',
  'holidays.col.dates': 'Dates',
  'holidays.col.schoolDays': 'School days off',
  'holidays.schoolDays': '{count} school days',
  'holidays.schoolDays.one': '1 school day',
  'holidays.schoolDays.zero': 'none (a weekend)',
  'holidays.nameHint': 'For example “Semester break” or “Ramazan Bayramı”. One language is enough; the other one is shown when it is missing.',
  'holidays.oneDay': 'One day: the same start and end date.',
  'holidays.deleteAsk': 'Delete “{name}”? Its days count as school days again.',
  'holidays.saved': 'Holiday saved.',
  'holidays.deleted': 'Holiday deleted.',
  'holidays.public.title': 'Turkish public holidays',
  'holidays.public.button': 'Add Turkish public holidays for this school year',
  'holidays.public.explain': 'Adds the fixed-date national holidays that fall inside this school year, one day each: 1 January, 23 April, 1 May, 19 May, 15 July, 30 August and 29 October. A day that is already on the calendar is skipped, so you can press it again safely.',
  'holidays.public.religious': 'Ramazan Bayramı and Kurban Bayramı move every year, so they are not in the list: add them by hand with “Add a holiday”, with the dates the ministry announces (and the semester break). Class Compass looks nothing up on the internet.',
  'holidays.public.added': '{added} public holidays added; {skipped} were on the calendar already.',
  'holidays.public.nothing': 'Nothing to add: the public holidays of this school year are on the calendar already.',
};

export const tr: Record<keyof typeof en, string> = {
  'holidays.title': 'Okul tatilleri',
  'holidays.intro': 'Bir eğitim yılında okulun olmadığı günler: yarıyıl tatili, millî ve dinî bayramlar. Raporlar bu günleri okul günü sayımlarına katmaz (0 ya da “kaydedilmedi” değil, “okul yok” görünür) ve Günün Yardımcısı o gün görev almaz. Öğretmen tatil gününde de ders başlatabilir (telafi dersi için).',
  'holidays.year': 'Eğitim yılı',
  'holidays.noYears': 'Henüz eğitim yılı yok. Önce Eğitim yılları ve dönemler bölümünden bir yıl ekleyin.',
  'holidays.archived': 'Bu eğitim yılı arşivlendi; tatilleri artık değiştirilemez.',
  'holidays.add': 'Tatil ekle',
  'holidays.edit': 'Tatili değiştir',
  'holidays.listCaption': '{year} tatilleri',
  'holidays.none': 'Henüz tatil yok. Yılın her pazartesi–cuma günü okul günü sayılıyor.',
  'holidays.col.name': 'Ad',
  'holidays.col.dates': 'Tarihler',
  'holidays.col.schoolDays': 'Tatil olan okul günü',
  'holidays.schoolDays': '{count} okul günü',
  'holidays.schoolDays.one': '1 okul günü',
  'holidays.schoolDays.zero': 'yok (hafta sonu)',
  'holidays.nameHint': 'Örneğin “Yarıyıl tatili” ya da “Ramazan Bayramı”. Tek dil yeterli; eksik olan dilde diğeri gösterilir.',
  'holidays.oneDay': 'Tek gün için başlangıç ve bitiş aynı tarih olur.',
  'holidays.deleteAsk': '“{name}” silinsin mi? Bu günler yeniden okul günü sayılır.',
  'holidays.saved': 'Tatil kaydedildi.',
  'holidays.deleted': 'Tatil silindi.',
  'holidays.public.title': 'Resmî tatiller',
  'holidays.public.button': 'Bu eğitim yılına resmî tatilleri ekle',
  'holidays.public.explain': 'Bu eğitim yılına denk gelen sabit tarihli millî tatilleri birer gün olarak ekler: 1 Ocak, 23 Nisan, 1 Mayıs, 19 Mayıs, 15 Temmuz, 30 Ağustos ve 29 Ekim. Takvimde zaten olan günler atlanır; düğmeye yeniden basmak sorun olmaz.',
  'holidays.public.religious': 'Ramazan Bayramı ve Kurban Bayramı her yıl başka tarihe denk gelir, bu yüzden listede yoktur: bakanlığın açıkladığı tarihlerle “Tatil ekle” ile siz ekleyin (yarıyıl tatilini de). Class Compass internette hiçbir şey aramaz.',
  'holidays.public.added': '{added} resmî tatil eklendi; {skipped} tanesi takvimde zaten vardı.',
  'holidays.public.nothing': 'Eklenecek bir şey yok: bu eğitim yılının resmî tatilleri takvimde zaten var.',
};

export const holidaysMessages = { en, tr };
registerMessages(holidaysMessages);

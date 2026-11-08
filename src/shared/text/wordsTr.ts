/**
 * Common Turkish words and verb stems for the student-text nonsense check (S13c, D-123). Written for
 * Class Compass (no third-party list; see docs/ASSETS.md). Matching folds the text (`foldForSearch`:
 * Turkish lower-case, ı→i, no diacritics) and strips common suffixes, so stems are listed once
 * ("oku" covers "okuyacağım", "okudum", "okumak"; "kitap" covers "kitabı" through the k/p/ç/t
 * consonant change).
 */
import { foldForSearch } from './turkish.ts';

const LIST = `
ve veya ile ama fakat çünkü için gibi kadar daha en çok az biraz hiç her hep bazen şimdi sonra önce bugün yarın dün sabah akşam öğle gece hafta ay yıl gün saat dakika
ben sen o biz siz onlar bu şu bunu şunu bir iki üç dört beş altı yedi sekiz dokuz on yirmi otuz kırk elli yüz bin ilk son yeni eski büyük küçük uzun kısa güzel iyi kötü
evet hayır tamam lütfen teşekkür merhaba hoşça kal günaydın iyi geceler var yok mi mı mu mü de da ki ne neden nasıl nerede kim hangi kaç
okul sınıf ders öğretmen öğrenci arkadaş anne baba kardeş abla ağabey abi dede nine anneanne babaanne teyze hala amca dayı kuzen aile ev oda bahçe park
kitap defter kalem silgi çanta masa sandalye tahta kâğıt kağıt resim boya şarkı müzik oyun oyuncak top bisiklet araba otobüs tren uçak gemi deniz göl nehir dağ orman ağaç çiçek
kedi köpek kuş balık at inek koyun tavuk aslan kaplan fil maymun tavşan kurbağa kelebek arı karınca yılan ayı tilki zürafa penguen
su süt ekmek peynir yumurta elma armut muz portakal çilek üzüm domates havuç patates çorba yemek kahvaltı öğle akşam yemeği pasta kurabiye şeker çay meyve sebze
renk kırmızı mavi yeşil sarı turuncu mor pembe siyah beyaz gri kahverengi
kelime cümle harf ses hece hikâye hikaye masal şiir paragraf metin soru cevap yanıt sayfa ödev proje sunum sınav test konu dil ingilizce türkçe matematik fen
okuma yazma dinleme konuşma dilbilgisi telaffuz kelime bilgisi alfabe
hedef amaç plan başarı çaba emek gayret yardım sorumluluk görev iş
oku yaz dinle konuş öğren öğret çalış çiz boya söyle anlat sor cevapla yanıtla düşün hatırla unut bil anla dene başla bitir tamamla yap et ol
gel git koş yürü atla yüz otur kalk uyu uyan ye iç al ver tut bak gör izle seyret dinle duy hisset sev beğen iste bekle kal dön getir götür taşı
aç kapa kapat yık temizle topla düzenle hazırla pişir yıka giy çıkar oyna eğlen gül ağla sevin üzül kız korkma kork yorul dinlen
tekrar et tekrarla ezberle pratik alıştırma kontrol düzelt göster paylaş katıl yardım et dikkat et hazırlan
her gün haftada günde kez defa sesli sessiz yavaş hızlı doğru yanlış dikkatli düzenli temiz düzgün mutlu üzgün yorgun heyecanlı
cesur nazik kibar sabırlı çalışkan meraklı yaratıcı yardımsever dürüst neşeli sakin
şey kişi insan çocuk kız oğlan erkek bebek ad isim yer zaman yol köprü şehir köy ülke dünya güneş ay yıldız bulut yağmur kar rüzgâr rüzgar hava mevsim
ilkbahar yaz sonbahar kış pazartesi salı çarşamba perşembe cuma cumartesi pazar ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık
el ayak baş göz kulak ağız burun saç diş kol bacak yüz kalp
film video bilgisayar tablet telefon internet fotoğraf kamera
yeni kelime anlam sözlük kart oyunu bulmaca yarışma takım grup çift
gerçekten çok güzel harika süper mükemmel eğlenceli zor kolay ilginç önemli
şarkı söyle resim yap kitap oku
sıkı iyice güzelce doğruca birlikte beraber yalnız kendi kendim
`;

export const TR_WORDS: ReadonlySet<string> = new Set(
  LIST.split(/\s+/u)
    .filter(Boolean)
    .map((w) => foldForSearch(w)),
);

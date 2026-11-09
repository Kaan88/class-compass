# Yapay zekâ araçları: bir yapay zekâ asistanı bağlamak

Sınıf Pusulası, **Claude Code** gibi bir yapay zekâ asistanının sınıflarınızla sizin adınıza çalışmasına izin verebilir: bir raporu okuyup kısa bir haftalık özet yazmak, hazır hedef önermek, haftanın ders konularını planlamak ya da bir tema tasarlamak gibi. Asistan, yapay zekâ araçları için açık bir standart olan **Model Context Protocol (MCP)** ile okulunuzun Sınıf Pusulası adresindeki `/mcp` bölümüne bağlanır.

Asistan, Sınıf Pusulası’nda sizin yapabildiklerinizin tam olarak aynısını yapabilir; üstelik yalnızca seçtiğiniz bölümlerde. Yaptığı her çağrı kaydedilir (neyin ne zaman çağrıldığı; içeriği asla), yaptığı her değişiklik de denetim kaydında adınızla ve "yapay zekâ aracıyla" notuyla görünür.

Yapay zekâ araçları bir yönetici açana kadar **kapalıdır**. Yönetici, okulun KVKK sorumlusuyla birlikte başka bir karar vermedikçe **öğrenci adları okulun içinde kalır**.

## Okuldan ne çıkar

**Takma adlarla** (varsayılan; okulun "Öğrenci verisi yapay zekâ araçlarına" ayarı kapalıyken tek seçenek):

- Öğrenciler **"Student 1", "Student 2"** gibi takma adlarla, kimlikleri de `student-1`, `student-2` diye görünür. Numaralar bir anahtar için hep aynı kalır; böylece asistan bir öğrenciyi sorular boyunca izleyebilir. Kendi isteklerinde `student-3` yazabilir (yalnızca sizin öğrencileriniz için).
- Sizin ya da başka öğretmenlerin yazdığı metinlerdeki (ders sonu değerlendirmesi, geri bildirim, ödev başlığı) öğrenci adları ve okul numaraları, uygulamanın tanıyabildiği ölçüde değiştirilir: Türkçe yazımlar (İ/I, ş, ğ…), büyük ya da küçük harf ve kesme işaretli ekler ("Elif’in") de tanınır. Öğrencinin tam adı takma adıyla, tek başına yazılmış bir ad ya da soyadı `[name]` ile, okul numarası da `[student no.]` ile değiştirilir.
- **Öğrencinin yazdığı her şey** (hedefler, değerlendirmeler, kendine notlar, kanıt metinleri ve bağlantılar) **gönderilmez**.
- Çıkanlar: okulun adı, öğretmen adları, sınıf ve ders adları, tarihler, toplamlarıyla birlikte sayılar, takma ad başına yoklama ve ödev durumları, adları değiştirilmiş kendi metinleriniz, hedef kategorileri ve hazır hedefler, ayarlar.

> **Yapay zekâ araçlarıyla kullanacağınız metinlere (geri bildirim, ders sonu değerlendirmesi, ödev başlığı) lütfen öğrenci adı ya da numarası yazmayın.** Uygulama her şeyi tanıyamaz: yanlış yazılmış adlar ve lakaplar, öğrencinin eski adı, okuldan ayrılıp silinmiş bir öğrencinin adı, küçük harfle ve kesme işareti olmadan ek almış bir ad ("elifin"), küçük harfle yazılmış Can, Su, Ay, Will ve May adları ve başında "no" olmayan kısa (bir ile üç haneli) numaralar yazıldığı gibi gider. Öğretmen adları ve okulunuzun adı değiştirilmez.

**Adlarla** (yalnızca yönetici öğrenci verisine izin verdiyse ve yalnızca "Adlar" seçilerek oluşturulan anahtarlarda):

- Öğrenci adları ve öğrencilerin yazdıkları da gönderilir. Öğrencilerin yazdıkları `untrustedText` olarak işaretlenir; asistan bunları bir talimat olarak değil, yalnızca veri olarak ele alır.

**Hiçbir durumda gönderilmeyenler:** dosyalar, fotoğraflar ve ses kayıtları; öğretmenin özel notları ve ödev notları; açıklanmadan önce Gizli Öğrenci seçimleri; gruplama seviyeleri; öğrenci bağlantılarının adresleri ve kodları; parolalar, PIN’ler ve oturum bilgileri; dışa aktarmalar, yedekler ve öğrenci silme.

> Verinin nereye gideceği kullandığınız yapay zekâ aracına bağlıdır: Claude Code ile kendi hesabınız üzerinden Anthropic’e gider. Yalnızca okulunuzun onayladığı araçları kullanın; denerken yalnızca kurgusal veriyle çalışın.

## Yöneticiler için: açma

Yönetim menüsünde **Yapay zekâ araçları**’nı açın.

- **Yapay zekâ araçları açık**: `/mcp` adresini açar. Kapalıyken hiçbir anahtar çalışmaz ve yeni anahtar oluşturulamaz.
- **Bir anahtarın en uzun geçerlilik süresi**: 7 ile 90 gün arası (varsayılan 90). Öğretmenler her anahtar için daha kısa bir süre seçer.
- **Öğrenci verisi yapay zekâ araçlarına**: varsayılan olarak kapalı. **Yalnızca okulunuzun KVKK sorumlusu onay verdikten** ve veli aydınlatma metni bunu belirttikten sonra açın. Açılan pencere okuldan nelerin çıkacağını listeler; onaylamak için `STUDENT DATA` yazın. Kapattığınızda bütün anahtarlar için hemen geçerli olur.
- **Okuldan ne çıkar** bölümü, yukarıdaki listeyi geçerli ayara göre tekrarlar.
- **Okuldaki anahtarlar** her anahtarı (gizli değerini asla göstermeden) hesabı, izinleri, gizlilik ayarı ve son kullanımıyla listeler. **İptal et** bir anahtarı hemen durdurur. Bu sayfadaki değişiklikler denetim kaydına yazılır.

Okulunuz Sınıf Pusulası’na Cloudflare Access üzerinden ulaşıyorsa, bilişim sorumlusunun `/mcp` adresini dışarıda bırakması gerekir (bkz. `docs/OPERATIONS.md`, "AI tools"): bir yapay zekâ aracı Cloudflare’e giriş yapamaz.

## Kişisel anahtar oluşturma

**Profil**’i açın (öğretmenler menüden, yöneticiler yönetim menüsünden) ve **Yapay zekâ araçları** bölümünü bulun. Sınıf bilgisayarında önce PIN sorulur.

1. **Yeni anahtar**’a basın.
2. **Ad**: nerede kullanacağınız, örneğin "Dizüstü bilgisayarımdaki Claude Code".
3. **İzinler**: yalnızca asistanın gerçekten ihtiyaç duyduklarını seçin. Başlangıçta okuma izinleri seçili gelir. Öğretmenler şunları seçebilir: sınıflarımı, öğrencilerimi ve ödevleri görme; raporları ve öğrenci zaman çizelgelerini okuma; hedefleri okuma; hedef, hazır hedef, cümle başlangıcı ve geri bildirim yazma; ödev verme ve işaretleme; süren bir derste sınıf işlemleri; sınıf ayarlarını değiştirme. Yöneticiler şunları seçebilir: okul yapısını ve okul geneli raporları okuma; okul ayarlarını değiştirme; tema taslağı kaydetme.
4. **Geçerlilik süresi**: gün sayısı; en fazla okulun izin verdiği kadar.
5. **Öğrenciler nasıl görünsün**: yalnızca okul adlara izin veriyorsa görünür. Takma adlar güvenli varsayılandır.
6. **Mevcut parolanızı** yazın (e-posta bağlantısıyla giriş yapan hesaplar önce yeniden giriş yapar) ve **Anahtar oluştur**’a basın.

Anahtar (`ccmcp_` ile başlar) **yalnızca bir kez gösterilir**. Onu ya da hazır Claude Code komutunu kopyalayın ve bir parola gibi saklayın. Sınıf Pusulası yalnızca parmak izini saklar.

Listede anahtarlarınız izinleri, son geçerlilik tarihi ve son kullanımıyla görünür. **İptal et** bir anahtarı hemen durdurur; yeniden gerektiğinde yeni bir anahtar oluşturun.

## Claude Code

Claude Code kurulu olan kendi bilgisayarınızda penceredeki komutu çalıştırın. Komut şuna benzer (örneklerin yerine okulunuzun adresi ve sizin anahtarınız gelir):

```
claude mcp add --transport http class-compass https://school.example.org/mcp --header "Authorization: Bearer ccmcp_…"
```

Ardından Claude’a örneğin şunu sorun: "class-compass’ı kullan: 3-A İngilizce dersinin geçen haftasının kısa bir özetini çıkar." Claude işe **list_my_classes** ile başlar; isterseniz bir şeyi değiştirmeden önce size sorar.

İşe yarayan araçlar: **class_overview**, **class_report** (rapor büyükse birkaç bölüm isteyin), **student_summary**, **goal_library**, **create_goal_preset**, **create_sentence_starter**, **get_topic_plan** ve **set_topic_plan**, **create_homework**; temalar için **theme_schema**, **validate_theme** ve yöneticiler için **import_theme_draft** (taslak kaydeder; bir temayı etkinleştirmek **Temalar** sayfasında sizin kararınız olarak kalır). Hazır istekler (prompts): haftalık özet, hazır hedefler, konu planı, tema tasarımı.

## claude.ai ve Claude Desktop (yakında)

> Bu bölüm henüz hazır değil. claude.ai ya da Claude Desktop’ı "özel bağlayıcı" olarak bağlamak, yapıştırılan bir anahtar yerine tarayıcıda bir giriş (OAuth) gerektirir; bu, yapay zekâ araçlarının bir sonraki aşamasıyla gelecek. O zamana kadar Claude Code’u kişisel bir anahtarla kullanın.

## Bilmekte fayda var

- Bir anahtar yalnızca `/mcp` adresinde çalışır, uygulamanın kendisinde asla; oturum açık bir tarayıcı da `/mcp` adresini kullanamaz.
- Her anahtar dakikada yaklaşık 120 çağrı yapabilir; çok büyük yanıtlar, daha dar bir soru sorulmasını isteyen bir notla kısaltılır.
- Bir hesap devre dışı bırakıldığında ya da parolası sıfırlandığında veya değiştirildiğinde bütün anahtarları kalıcı olarak iptal edilir (hesap yeniden etkinleştirilse de geri gelmez); sonra yenilerini oluşturun. Yönetici bir anahtarın en uzun geçerlilik süresini kısaltırsa var olan anahtarların süresi de kısalır.
- Asistan, tıpkı sizin gibi yalnızca kendi sınıflarınızı ve öğrencilerinizi görür.

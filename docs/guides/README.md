# Class Compass user guides / Sınıf Pusulası kullanım kılavuzları

These guides are for the people who use Class Compass at school. Each guide exists in English (`en/`) and Turkish (`tr/`) with the same file name. The app shows them read-only under **Help** (teacher and admin menus, the student page and the Super Speakers scorer app), in the user's interface language.

Bu kılavuzlar Sınıf Pusulası'nı okulda kullananlar içindir. Her kılavuz aynı dosya adıyla İngilizce (`en/`) ve Türkçe (`tr/`) olarak bulunur. Uygulama bunları **Yardım** altında (öğretmen ve yönetici menüleri, öğrenci sayfası ve Süper Konuşmacılar puanlayıcı uygulaması) kullanıcının arayüz dilinde, salt okunur olarak gösterir.

## Guides / Kılavuzlar

| For / Kimin için | English | Türkçe |
| --- | --- | --- |
| Teachers: quick start | [Quick start for teachers](en/quick-start-teacher.md) | [Öğretmenler için hızlı başlangıç](tr/quick-start-teacher.md) |
| Teachers | [Teacher guide](en/teacher.md) | [Öğretmen kılavuzu](tr/teacher.md) |
| Administrators: quick start | [Quick start for administrators](en/quick-start-admin.md) | [Yöneticiler için hızlı başlangıç](tr/quick-start-admin.md) |
| Administrators | [Administrator guide](en/admin.md) | [Yönetici kılavuzu](tr/admin.md) |
| Super Speakers: administrators | [Super Speakers guide](en/super-speakers.md) | [Süper Konuşmacılar kılavuzu](tr/super-speakers.md) |
| Super Speakers: scorers (one page, also the scorer's quick start) | [Scorer guide](en/scorer.md) | [Puanlayıcı kılavuzu](tr/scorer.md) |
| Super Speakers: board screen (one page) | [Board screen setup](en/board-screen.md) | [Pano ekranı kurulumu](tr/board-screen.md) |
| Students: quick start | [Quick start for students](en/quick-start-student.md) | [Öğrenciler için hızlı başlangıç](tr/quick-start-student.md) |
| Students and parents | [Students and parents guide](en/student.md) | [Öğrenciler ve veliler kılavuzu](tr/student.md) |

The IT person's server guide (installation, email, backups, restore) is `docs/OPERATIONS.md`; it is not part of the in-app Help.

## For maintainers

- **Match the app.** Every button and page name is written exactly as in `src/shared/i18n/en.ts` (English guides) and `src/shared/i18n/tr.ts` (Turkish guides). The Turkish guides are written for Turkish primary-school teachers, not translated word for word. When a label changes in the app, change the guides too. Features behind a module or media switch say so.
- **Format.** Plain Markdown that the in-app viewer understands: headings, paragraphs, lists (one nested level), `>` notes, tables, images on their own line, links to other guides (`teacher.md#anchor`) and in-page anchors. No HTML, no remote images; external web links are not used. Every guide starts with exactly one `#` heading.
- **Images** live in `img/en/` and `img/tr/` (PNG, lower-case names) and are referenced as `../img/<lang>/<name>.png`. Every image must be used.
- **Test.** `npx vitest run tests/docs` checks that both languages have the same guides, that every guide link, anchor and image exists, that every image is used and small enough, and the Markdown parser. `e2e/help.spec.ts` checks the in-app Help in both languages, including axe.

## Updating the screenshots

The screenshots are made by a Playwright script that is **not** part of the normal test suite:

```
npm run docs:screenshots
```

(the same as `npx playwright test -c playwright.docs.config.ts`). It starts its own server with a fresh, fictional demo school (`seed:demo` plus six weeks of `seed:demo-history`), takes every picture in English and Turkish at 1280×900 and saves compressed PNGs into `docs/guides/img/en/` and `docs/guides/img/tr/`, replacing the old ones. Run it after any visible UI change, check the pictures, then run `npx vitest run tests/docs`. Only fictional demo data may appear in the pictures.

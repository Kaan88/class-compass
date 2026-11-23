# Security policy

Class Compass is used by a primary school, so a security problem can affect children's data. Thank you
for telling us about one privately.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: on this repository open
**Security → Report a vulnerability** and describe:

- what the problem is and where (endpoint, page or file),
- how to reproduce it, on a local install with the demo data (`npm run seed:demo`),
- what an attacker could read or change.

You should get an answer within a week. Please give us time to fix the problem before you write about
it in public.

## Rules for testing

- Test on your own local install only. Do not test against a school's site, and do not try to read,
  change or delete data that is not yours.
- Never put real names, student data, passwords or tokens into a report; fictional data is enough.
- No denial of service, no social engineering, no automated scanning of a school's site.

## Supported versions

Only the latest commit on `main` is supported; fixes are not backported.

---

**Türkçe:** Bir güvenlik açığı bulduysanız lütfen herkese açık bir kayıt (issue) açmayın. Bu depoda
**Security → Report a vulnerability** yolunu kullanarak özel olarak bildirin. Yalnızca kendi yerel
kurulumunuzda, demo verilerle deneyin; bildirime gerçek ad, öğrenci verisi, parola ya da anahtar
yazmayın. Bir hafta içinde yanıt vermeye çalışırız.

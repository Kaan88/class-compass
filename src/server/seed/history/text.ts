/**
 * Fictional text for the demo history: short, child-like English and Turkish sentences and teacher
 * notes. Nothing here is real or copied from anywhere. Links use the reserved example domains.
 */
import type { TopicIcon } from '../../../shared/lessons.ts';

export const LESSON_NOTES = [
  'Great energy after the break.',
  'Group work was noisy but productive.',
  'The song warm-up worked well.',
  'Some children were tired today.',
  'We ran out of time for the game.',
  'Lovely speaking practice in pairs.',
  'Ders çok verimli geçti.',
  'Sınıf bugün biraz dağınıktı.',
  'Oyun bölümü çok sevildi.',
  'Yeni kelimeleri hızlı öğrendiler.',
];

export const SECRET_NOTES = [
  'Used English the whole lesson!',
  'Helped a friend kindly.',
  'Tidied the table without being asked.',
  'Listened really well.',
  'Bütün ders İngilizce konuştu.',
  'Arkadaşına çok güzel yardım etti.',
];

export const HOMEWORK: Record<string, Array<{ title: string; details?: string }>> = {
  english: [
    { title: 'Workbook page 12', details: 'Exercises 1 and 2.' },
    { title: 'Learn the colour words', details: 'Red, blue, green, yellow, purple, orange.' },
    { title: 'Draw your family and label it' },
    { title: 'Read the story about the cat', details: 'Read it aloud to someone at home.' },
    { title: 'Write five animal words' },
    { title: 'Workbook page 15' },
    { title: 'Practise the days of the week song' },
    { title: 'Find three things that are round' },
    { title: 'Kelime kartlarını tekrar et' },
    { title: 'Write about your favourite food' },
  ],
  mathematics: [
    { title: 'Times tables 2, 5 and 10' },
    { title: 'Worksheet: adding to 100' },
    { title: 'Measure three things at home', details: 'Use a ruler and write the centimetres.' },
    { title: 'Toplama ve çıkarma alıştırması' },
    { title: 'Shapes hunt: find a triangle and a circle' },
    { title: 'Problem çözme sayfası 24' },
  ],
  science: [
    { title: 'Find three living things in the garden' },
    { title: 'Draw the parts of a plant' },
    { title: 'Evdeki maddeleri sınıflandır', details: 'Katı, sıvı ve gaz örnekleri yaz.' },
    { title: 'Watch the weather for three days' },
  ],
  other: [{ title: 'Revision sheet' }, { title: 'Tekrar çalışması' }],
};

export const HOMEWORK_NOTES = ['Check who needs extra help.', 'Some children forgot their books.', 'Velilere hatırlat.'];

/** Goals the children write themselves (custom goals). */
export const STUDENT_GOALS: Record<string, string[]> = {
  english: [
    'I want to say my name and age in English.',
    'I will learn the animal words.',
    'I want to read a book in English by myself.',
    'I will ask for things in English in class.',
    'I want to sing the whole song.',
    'İngilizce renkleri ezberleyeceğim.',
    'Her gün iki yeni kelime öğreneceğim.',
  ],
  mathematics: ['I want to know my 5 times table.', 'I will count to 100 without help.', 'Çarpım tablosunu öğreneceğim.', 'Saatleri okumayı öğreneceğim.'],
  science: ['I want to grow a bean plant.', 'I will learn the parts of a flower.', 'Hayvanların neler yediğini öğreneceğim.'],
  other: ['I will try my best.', 'Elimden geleni yapacağım.'],
};

export const PRACTICE_CHOICES: Record<string, string[]> = {
  english: ['Read with a friend', 'Sing the song at home', 'Use word cards', 'Play the memory game', 'Kelime kartları'],
  mathematics: ['Practise with counters', 'Times table song', 'Sayı oyunu'],
  science: ['Look in the garden', 'Draw what I see', 'Deney defteri'],
  other: ['Practise at home'],
};

export const REFLECTIONS = [
  'I learned a new word today.',
  'It was hard but I tried.',
  'I can do it better now.',
  'I read the story to my mum.',
  'I liked the game with my friends.',
  'I need more practice.',
  'Today I was brave and I talked.',
  'Bugün çok eğlendim.',
  'Biraz zorlandım ama yaptım.',
  'Artık daha kolay geliyor.',
  'Annemle birlikte çalıştım.',
];

export const STUDENT_NOTES = ['Remember to bring my book.', 'Ask the teacher about the song.', 'Kitabımı getirmeyi unutma.', 'My brother helped me.'];

export const TEXT_EVIDENCE = [
  'I wrote five words: cat, dog, red, sun, tree.',
  'I read "The Big Red Bus" at home.',
  'I counted to 100 with my dad.',
  'I drew my family and wrote their names.',
  'Kuzenime İngilizce şarkı söyledim.',
  'Evde üç kitap okudum.',
  'I made a poster about animals.',
];

/** Fictional links on reserved example domains (never fetched). */
export const LINK_EVIDENCE = [
  'https://example.org/my-class-blog/animal-poster',
  'https://example.com/kids-reading/story-12',
  'https://example.net/songs/days-of-the-week',
  'https://example.org/maths-games/times-tables',
  'https://example.com/science/bean-diary',
];

export const TEACHER_PROGRESS = [
  'Reads simple sentences with more confidence.',
  'Uses the new words in class without help.',
  'Still needs reminders but is trying hard.',
  'Answered three questions in English today.',
  'Daha özgüvenli konuşuyor.',
  'Kelimeleri doğru telaffuz ediyor.',
];

export const TEACHER_FEEDBACK = [
  'Well done! Your reading is getting better every week.',
  'Great job using English in group work.',
  'Keep practising your words at home.',
  'I am proud of how hard you are trying.',
  'Lovely handwriting this week!',
  'Harika gidiyorsun, böyle devam!',
  'Çok güzel bir çalışma olmuş.',
  'Sesli okumaya devam et.',
];

export const PRIVATE_NOTES = [
  'Seems tired on Mondays; check in quietly.',
  'Works better when seated near the front.',
  'Very shy with the whole class, chatty in pairs.',
  'Ask about the reading folder at the next parent meeting.',
  'Kalabalık grupta çekingen, ikili çalışmada daha rahat.',
  'Veli görüşmesinde okuma alışkanlığını konuş.',
];

export const TEACHER_EVIDENCE = [
  'Read the whole story aloud in front of the class.',
  'Wrote a short card for a friend in English.',
  'Sınıfta tahtada problemi tek başına çözdü.',
  'Explained the plant poster to the group.',
];

/** Custom skill categories for subjects that are not English (topics and goals). */
export const SUBJECT_CATEGORIES: Record<string, Array<{ name: { en: string; tr: string }; icon: TopicIcon; preset: { en: string; tr: string } }>> = {
  mathematics: [
    { name: { en: 'Numbers', tr: 'Sayılar' }, icon: 'puzzle', preset: { en: 'I will count to 100 in tens.', tr: 'Onar onar 100’e kadar sayacağım.' } },
    { name: { en: 'Shapes', tr: 'Şekiller' }, icon: 'star', preset: { en: 'I will name four shapes.', tr: 'Dört şeklin adını söyleyeceğim.' } },
    { name: { en: 'Problem solving', tr: 'Problem çözme' }, icon: 'game', preset: { en: 'I will draw a picture to solve a problem.', tr: 'Problemi çözmek için resim çizeceğim.' } },
  ],
  science: [
    { name: { en: 'Living things', tr: 'Canlılar' }, icon: 'star', preset: { en: 'I will name three animals and what they eat.', tr: 'Üç hayvanı ve ne yediklerini söyleyeceğim.' } },
    { name: { en: 'Materials', tr: 'Maddeler' }, icon: 'puzzle', preset: { en: 'I will sort things into solid and liquid.', tr: 'Eşyaları katı ve sıvı olarak ayıracağım.' } },
    { name: { en: 'Experiments', tr: 'Deneyler' }, icon: 'paint', preset: { en: 'I will say what I think will happen.', tr: 'Ne olacağını tahmin edip söyleyeceğim.' } },
  ],
};

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

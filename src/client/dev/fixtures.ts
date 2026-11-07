/**
 * Fictional sample students for the component catalog and layout checks (ENG-4). Invented names
 * only — no real children. Mix of multi-part Turkish names and a few English names.
 */
const NAMES = [
  'Ayşe Nur Kaya',
  'Ömer Faruk Yıldız',
  'Elif Su Demir',
  'Çınar Öztürk',
  'Ilgın Şahin',
  'İpek Aydın',
  'Yiğit Çelik',
  'Zeynep İrem Arslan',
  'Göktuğ Uğurlu',
  'Şevval Kılıç',
  'Oliver Smith',
  'Irmak Doğan',
  'Mehmet Ali Kara Yılmaz',
  'Defne Güneş',
  'Ege Işık',
  'Öykü Polat',
  'Barış Ünal',
  'Mia Johnson-Kaya',
  'Nehir Bulut',
  'Kağan Tekin',
  'Asya Ergün',
  'Poyraz Karataş',
  'Eylül İnce',
  'Sarp Çakır',
  'Duru Öner',
  'Emma Clarke',
  'Toprak Sağlam',
  'Hira Gündoğdu',
  'Efe Koç',
  'Yağmur Kurt',
  'Arda Özkan',
  'Selin Şimşek',
  'Berk Akgül',
  'Gökçe Aslan Uçar',
] as const;

export interface SampleStudent {
  id: string;
  fullName: string;
  weeklyCount: number;
  absent: boolean;
}

export function sampleStudents(n: number): SampleStudent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `sample-${i + 1}`,
    fullName: NAMES[i % NAMES.length]!,
    weeklyCount: (i * 7) % 6,
    absent: i % 9 === 4,
  }));
}

/** English default levels (CNT-6): ≥2 amber, ≥4 deeper amber, ≥6 red. */
export const levelFor = (count: number): 0 | 1 | 2 | 3 => (count >= 6 ? 3 : count >= 4 ? 2 : count >= 2 ? 1 : 0);

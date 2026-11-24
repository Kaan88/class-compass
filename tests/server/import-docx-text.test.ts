/**
 * Word import (IMP-1): the text of one cell or paragraph of mammoth's HTML. Tags are removed until none
 * is left (code scanning: js/incomplete-multi-character-sanitization), and the result is plain text.
 * Fictional names only.
 */
import { describe, expect, it } from 'vitest';
import { decode } from '../../src/server/modules/import/parsers/docx.ts';

describe('docx cell text (IMP-1)', () => {
  it('removes tags, also ones that only appear after another tag is removed', () => {
    expect(decode('<td><p><strong>Elif</strong> Yıldız</p></td>')).toBe('Elif Yıldız');
    expect(decode('<p>Deniz<br/>Kaya</p>')).toBe('Deniz Kaya');
    // Broken or nested markup never leaves a complete tag behind, whatever is left of it as text.
    for (const odd of ['<scr<b>ipt>Ayşe</scr<i>ipt>', '<<p>p>Mert<</p>/p>', '<a<b<c>>>Zeynep', '<p>Can<', '>Ece<p>']) expect(decode(odd)).not.toMatch(/<[^>]*>/u);
    expect(decode('<a<b<c>>>Zeynep')).toContain('Zeynep');
  });

  it('decodes entities last, so text that looks like a tag stays text', () => {
    expect(decode('<p>3 &lt; 5 &amp; 7 &gt; 2</p>')).toBe('3 < 5 & 7 > 2');
    expect(decode('<p>&amp;lt;b&amp;gt;</p>')).toBe('&lt;b&gt;');
    expect(decode('<p>O&#39;Neil&nbsp;&quot;Can&quot;</p>')).toBe('O\'Neil "Can"');
  });
});

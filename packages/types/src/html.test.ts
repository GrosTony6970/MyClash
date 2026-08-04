import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapes the five characters that can break out of text or an attribute', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('escapes the ampersand once, not twice', () => {
    // Naive chained replaces in the wrong order double-escape: &lt; → &amp;lt;.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('leaves a value with nothing to escape untouched', () => {
    expect(escapeHtml('Jean Dupont — Lyon AMHE')).toBe('Jean Dupont — Lyon AMHE');
    expect(escapeHtml('')).toBe('');
  });

  it('neutralises a script tag typed into a roster name', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps a quoted attribute intact', () => {
    const value = escapeHtml('red" onload="alert(1)');
    expect(`<td title="${value}">`).toBe('<td title="red&quot; onload=&quot;alert(1)">');
  });
});

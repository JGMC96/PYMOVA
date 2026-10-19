import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from '@/lib/csv';

describe('csvCell', () => {
  it('neutraliza los prefijos de fórmula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1+1')).toBe('"\'+1+1"');
    expect(csvCell('-cmd')).toBe('"\'-cmd"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('\tx')).toBe('"\'\tx"');
  });

  it('escapa las comillas dobles y deja el texto normal intacto', () => {
    expect(csvCell('Ana "la jefa" Pérez')).toBe('"Ana ""la jefa"" Pérez"');
    expect(csvCell('María López')).toBe('"María López"');
    expect(csvCell(null)).toBe('""');
  });

  it('csvRow deja los números sin comillas', () => {
    expect(csvRow(['=evil', 3, '1.50'])).toBe('"\'=evil",3,"1.50"');
  });
});

import { View } from 'react-native';
import {
  parseMarkdown,
  quoteToMessageMarkdown,
  quoteToPreviewMarkdown,
  setQuoteFromSelection,
  useQuote,
} from './quote';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

describe('parseMarkdown', () => {
  test('should return an empty text block for an empty string', () => {
    expect(parseMarkdown('')).toEqual([
      { type: 'text', text: '', tokens: [] }
    ]);
  });

  test('should handle markdown with only quote blocks', () => {
    const markdown = `> Quote one
> Quote two`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'quote',
        text: 'Quote one\nQuote two',
        tokens: [
          { kind: 'text', value: 'Quote one\nQuote two' }
        ]
      }
    ]);
  });

  test('should handle markdown with only text blocks', () => {
    const markdown = `Line one
Line two
Line three`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'text',
        text: 'Line one\nLine two\nLine three',
        tokens: [ { kind: 'text', value: 'Line one\nLine two\nLine three' } ]
      }
    ]);
  });

  test('should correctly separate quote and text blocks', () => {
    const markdown = `> Quote one
> Quote two

Regular text line one.
Regular text line two.

> Quote three

Regular text after quote.`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'quote',
        text: 'Quote one\nQuote two',
        tokens: [
          {
            kind: 'text',
            value: 'Quote one\nQuote two'
          }
        ]
      },
      {
        type: 'text',
        text: 'Regular text line one.\nRegular text line two.',
        tokens: [
          {
            kind: 'text',
            value: 'Regular text line one.\nRegular text line two.'
          }
        ]
      },
      {
        type: 'quote',
        text: 'Quote three',
        tokens: [ { kind: 'text', value: 'Quote three' } ]
      },
      {
        type: 'text',
        text: 'Regular text after quote.',
        tokens: [ { kind: 'text', value: 'Regular text after quote.' } ]
      }
    ]);
  });

  test('should allow escaping quote blocks', () => {
    const markdown = `> Quote one
\\> Quote two
> Quote three`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'quote',
        text: 'Quote one',
        tokens: [ { kind: 'text', value: 'Quote one' } ]
      },
      {
        type: 'text',
        text: '> Quote two',
        tokens: [ { kind: 'text', value: '> Quote two' } ]
      },
      {
        type: 'quote',
        text: 'Quote three',
        tokens: [ { kind: 'text', value: 'Quote three' } ]
      },
    ]);
  });

  test('should allow escaping escapes', () => {
    const markdown = `> Quote one
\\\\> Quote \\\\ two
> Quote three
\\\\\\> Quote \\\\ four
> Quote five
\\\\\\\\> Quote \\\\ six
`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'quote',
        text: 'Quote one',
        tokens: [ { kind: 'text', value: 'Quote one' } ]
      },
      {
        type: 'text',
        text: '\\> Quote \\\\ two',
        tokens: [ { kind: 'text', value: '\\> Quote \\\\ two' } ]
      },
      {
        type: 'quote',
        text: 'Quote three',
        tokens: [ { kind: 'text', value: 'Quote three' } ]
      },
      {
        type: 'text',
        text: '\\> Quote \\\\ four',
        tokens: [ { kind: 'text', value: '\\> Quote \\\\ four' } ]  },
      {
        type: 'quote',
        text: 'Quote five',
        tokens: [ { kind: 'text', value: 'Quote five' } ]
      },
      {
        type: 'text',
        text: '\\\\> Quote \\\\ six',
        tokens: [ { kind: 'text', value: '\\\\> Quote \\\\ six' } ]
      },
    ]);
  });

  test('should parse the provided sample correctly', () => {
    const markdown = `> You're pretty cool
> :)

Thanks, but I'm not really.

I'm a pretty big fan of you though...

> What do you like to drink during winter?

Mom makes really nice chicken broth around this time of year.`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'quote',
        text: "You're pretty cool\n:)",
        tokens: [ { kind: 'text', value: "You're pretty cool\n:)" } ] },
      {
        type: 'text',
        text: "Thanks, but I'm not really.\n\nI'm a pretty big fan of you though...",
        tokens: [
          {
            kind: 'text',
            value: "Thanks, but I'm not really.\n\nI'm a pretty big fan of you though..."
          }
        ]
      },
      {
        type: 'quote',
        text: 'What do you like to drink during winter?',
        tokens: [
          {
            kind: 'text',
            value: 'What do you like to drink during winter?'
          }
        ]
      },
      {
        type: 'text',
        text: 'Mom makes really nice chicken broth around this time of year.',
        tokens: [
          {
            kind: 'text',
            value: 'Mom makes really nice chicken broth around this time of year.'
          }
        ]
      }
    ]);
  });

  test('should extract optional attribution from quote block', () => {
    const markdown = `> I like turtles\n>\n> - turtle kid`;
    expect(parseMarkdown(markdown)).toEqual([
      {
        type: 'quote',
        text: 'I like turtles',
        attribution: 'turtle kid',
        tokens: [ { kind: 'text', value: 'I like turtles' } ]
      }
    ]);
  });
});


describe('quoteToPreviewMarkdown', () => {
  it('returns an empty string when given null', () => {
    expect(quoteToPreviewMarkdown(null)).toBe('');
  });

  it('limits the preview to three quoted lines and includes an attribution', () => {
    const quote = {
      text: 'Line one\nLine two\nLine three\nLine four',
      attribution: 'Author Name',
    };

    const result = quoteToPreviewMarkdown(quote);

    const lines = result.split('\n');
    const quotedLines = lines.filter((line) => line.startsWith('>') && !line.startsWith('>-'));
    const attributionLine = lines.find((line) => line.startsWith('>-'));

    expect(quotedLines.length).toBeLessThanOrEqual(3);
    expect(attributionLine).toBeDefined();
  });

  it('prefers the first text block when the original markdown starts with a quote block', () => {
    const quote = {
      text: `> Quoted line\n\nPlain text line that should be chosen.`,
      attribution: 'Tester',
    };

    const result = quoteToPreviewMarkdown(quote);

    // The preview should contain the plain text line but not the quoted line.
    expect(result).toContain('>Plain text line that should be chosen.');
    expect(result).not.toContain('>Quoted line');
  });

  it('blank blocks are ignored', () => {
    const quote = {
      text: `
>🇨🇳

> 6 year neet veteran

>17 cats owner

>idk what am i doing w my life
`.trim(),
      attribution: 'Tester',
    };

    const result = quoteToPreviewMarkdown(quote);

    // The preview should contain the plain text line but not the quoted line.
    expect(result).toBe(`
>🇨🇳
>- Tester
`.trim());
  });
});


describe('quoteToMessageMarkdown', () => {
  it('includes every line of the provided quote text and the attribution', () => {
    const quote = {
      text: 'Line one\nLine two',
      attribution: 'Author',
    };

    const expected = `>Line one\n>Line two\n>- Author`;
    expect(quoteToMessageMarkdown(quote)).toBe(expected);
  });

  it('returns an empty string when quote is null', () => {
    expect(quoteToMessageMarkdown(null)).toBe('');
  });
});

describe('setQuoteFromSelection', () => {
  const QuoteProbe = () => {
    const quote = useQuote();
    return <View testID={quote ? quote.text : 'none'} />;
  };

  const quoteAfterSelecting = (start: number, end: number): string => {
    setQuoteFromSelection('Hello\n\n \nWorld', 'Author', { start, end });

    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<QuoteProbe />); });
    const text = renderer.root.findByType(View).props.testID;
    act(() => renderer.unmount());

    return text;
  };

  it('quotes the selected text', () => {
    expect(quoteAfterSelecting(14, 0)).toBe('Hello\n\n \nWorld');
  });

  it('quotes nothing for a selection of blank lines', () => {
    expect(quoteAfterSelecting(0, 5)).toBe('Hello');
    expect(quoteAfterSelecting(5, 9)).toBe('none');
  });
});

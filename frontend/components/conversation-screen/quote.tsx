
/**
 * Quote parsing utilities with explicit block + inline stages
 * and hyperlink tokenization. Implements requested style tweaks:
 *   • use `type` aliases (no interfaces)
 *   • arrow functions for all helpers
 *   • named exports collected at the bottom of the file
 */

import { useEffect, useState } from 'react';
import { listen, notify, lastEvent } from '../../events/events';
import { truncateText } from '../../util/util';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type RawBlockKind = 'quote' | 'text';

// Inline‑tokens -----------------------------------------------------------

type TextToken = { kind: 'text'; value: string };

/**
 * Raw‑URL hyperlink (no Markdown [label](url) support)
 * display == original captured string (can differ from `url` iff we prepend https://)
 */
export type LinkToken = { kind: 'link'; url: string; display: string };

type InlineToken = TextToken | LinkToken;

// Structural blocks ------------------------------------------------------

type QuoteBlock = {
  type: 'quote';
  text: string;
  attribution?: string;
  tokens: InlineToken[];
};

type TextBlock = {
  type: 'text';
  text: string;
  tokens: InlineToken[];
};

type MarkdownBlock = QuoteBlock | TextBlock;

// Domain entities --------------------------------------------------------

// The quiz card a reply is about. Travels with the quote from the feed to the
// composer, then onto the message as `@question_id`; the quote's markdown is
// only the fallback for clients that can't render the card.
type QuoteCard = {
  questionId: number
  question: string
  topic: string
  subjectAnswer: boolean | null
};

type Quote = { text: string; attribution: string; card?: QuoteCard };

const quizCardQuoteText = (
  question: string,
  subjectAnswer: boolean | null,
): string =>
  subjectAnswer === null
    ? question
    : `${question} — ${subjectAnswer ? 'Yes' : 'No'}`;

// ──────────────────────────────────────────────────────────────────────────
// Constants / Regexes
// ──────────────────────────────────────────────────────────────────────────

const eventKey = 'conversation-quote';
const attributionRegex = /^\s*-\s*/;
// Bare‑URL matcher: begins with http(s):// OR www. and runs until whitespace/punctuation
const RAW_URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>{}\[\]"]+)/gi;

// ──────────────────────────────────────────────────────────────────────────
// Inline lexical analysis
// ──────────────────────────────────────────────────────────────────────────

/** Remove common trailing punctuation that does not belong to the URL */
const _trimURL = (url: string): string => {
  // Balance‑aware trim for parentheses – simple heuristic.
  const isBalanced = (s: string) => s.split('(').length === s.split(')').length;
  while (/[.,;:!?)]$/.test(url) && isBalanced(url)) {
    url = url.slice(0, -1);
  }
  return url;
};

/**
 * Convert a raw string into TEXT / LINK tokens.
 * Adds https:// prefix when link started with www.
 */
const tokenizeInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  RAW_URL_REGEX.lastIndex = 0; // safety for global regex reuse
  while ((match = RAW_URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ kind: 'text', value: text.slice(lastIdx, match.index) });
    }

    let captured = match[0];
    captured = _trimURL(captured);

    const normalized = captured.startsWith('www.') ? `https://${captured}` : captured;
    tokens.push({ kind: 'link', url: normalized, display: captured });

    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    tokens.push({ kind: 'text', value: text.slice(lastIdx) });
  }
  return tokens;
};

const isLinkToken = (t: InlineToken): t is LinkToken => t.kind === 'link';

// ──────────────────────────────────────────────────────────────────────────
// Block‑level parsing (syntactic analysis)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Given lines inside a quote block (without leading '>'),
 * extract attribution if last non‑blank line starts with '- '.
 */
const _parseQuoteBlock = (lines: string[]): QuoteBlock => {
  const trimmedLines = lines.map(l => l.trim());
  let attribution: string | undefined;
  let endIdx = lines.length;

  for (let i = trimmedLines.length - 1; i >= 0; i--) {
    const ln = trimmedLines[i];
    if (ln === '') continue;
    if (attributionRegex.test(ln)) {
      attribution = ln.replace(attributionRegex, '');
      endIdx = i; // exclude attribution line from quote text
    }
    break;
  }

  const text = lines.slice(0, endIdx).join('\n').trim();
  return { type: 'quote', text, attribution, tokens: tokenizeInline(text) };
};

/**
 * Primary block parser – splits incoming markdown into quote / text blocks
 * (strips leading '>' from quote lines, converts inline tokens).
 */
const parseMarkdown = (markdown: string): MarkdownBlock[] => {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];

  let curType: RawBlockKind | null = null;
  let curLines: string[] = [];

  const flush = () => {
    if (!curType || curLines.length === 0) return;
    if (curType === 'quote') {
      blocks.push(_parseQuoteBlock(curLines));
    } else {
      const text = curLines.join('\n').trim();
      blocks.push({ type: 'text', text, tokens: tokenizeInline(text) });
    }
    curLines = [];
  };

  for (const raw of lines) {
    const isQuote = raw.trim().startsWith('>');
    if (isQuote) {
      if (curType !== 'quote') {
        flush();
        curType = 'quote';
      }
      curLines.push(raw.replace(/^>\s*/, ''));
    } else {
      if (curType !== 'text') {
        flush();
        curType = 'text';
      }
      // Protect escaped leading '>' (markdown spec)
      curLines.push(raw.replace(/^(\\+)>/, (_s, slashes) => '\\'.repeat(Math.floor(slashes.length / 2)) + '>'));
    }
  }
  flush();
  return blocks;
};

// ──────────────────────────────────────────────────────────────────────────
// Quote selection helpers (unchanged logic, refactored style)
// ──────────────────────────────────────────────────────────────────────────

const _quotablePortion = (quote: Quote | null): string => {
  if (!quote) return '';
  const best = parseMarkdown(quote.text)
    .filter(b => b.text.trim())
    .map((block, idx) => ({ block, idx }))
    .sort((a, b) => {
      if (a.block.type === b.block.type) return a.idx - b.idx;
      return a.block.type === 'text' ? -1 : 1; // prefer text over nested quote
    });
  return best.length ? best[0].block.text : '';
};

const _quoteToMarkdown = (quote: Quote | null, truncate: boolean): string => {
  if (!quote) return '';

  const txt = truncate ? truncateText(quote.text, { maxLength: 100, maxLines: 3 }) : quote.text;
  const attr = truncate ? truncateText(quote.attribution, { maxLength: 100, maxLines: 1 }) : quote.attribution;

  const quoted = txt.split('\n').map(l => `>${l}`).join('\n');
  return `${quoted}\n>- ${attr.replaceAll('\n', '')}`;
};

// API helpers ------------------------------------------------------------

const quoteToPreviewMarkdown = (quote: Quote | null) => {
  const portion = _quotablePortion(quote);
  if (!portion) return '';
  return _quoteToMarkdown({ text: portion, attribution: quote!.attribution }, true);
};

const quoteToMessageMarkdown = (quote: Quote | null) => {
  const portion = _quotablePortion(quote);
  if (!portion) return '';
  return _quoteToMarkdown({ text: portion, attribution: quote!.attribution }, false);
};

/**
 * The typed part of a message whose leading blockquote is rendered some other
 * way (e.g. as a live quiz card): everything after the message's first quote
 * block.
 */
const stripLeadingQuoteBlock = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim().startsWith('>')) {
    i++;
  }

  if (i === 0) {
    return markdown;
  }

  return lines.slice(i).join('\n').trim();
};

// ──────────────────────────────────────────────────────────────────────────
// Event‑based Quote store (unchanged)
// ──────────────────────────────────────────────────────────────────────────

const useQuote = (): Quote | null => {
  const _lastEvent = lastEvent<Quote>(eventKey) ?? null;

  const [quote, setQuote] = useState<Quote | null>(_lastEvent);

  useEffect(() => {
    return listen(eventKey, setQuote);
  }, []);

  return quote;
};

const setQuote = (quote: Quote | null) => {
  return notify(eventKey, quote);
};


// ──────────────────────────────────────────────────────────────────────────
// Exports – gathered here per request
// ──────────────────────────────────────────────────────────────────────────

export {
  InlineToken,
  isLinkToken,
  MarkdownBlock,
  parseMarkdown,
  Quote,
  QuoteBlock,
  QuoteCard,
  quizCardQuoteText,
  quoteToMessageMarkdown,
  quoteToPreviewMarkdown,
  setQuote,
  stripLeadingQuoteBlock,
  TextBlock,
  TextToken,
  tokenizeInline,
  useQuote,
};

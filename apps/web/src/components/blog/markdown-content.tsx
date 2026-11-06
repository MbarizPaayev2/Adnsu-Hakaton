import React from 'react';
import { articleHeadings } from '@/lib/blog/headings';
import Link from 'next/link';

interface MarkdownContentProps {
  content: string;
}

function renderInline(text: string): React.ReactNode {
  // Matches [text](url), **bold**, `code`
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[2] && match[3]) {
      // [text](url)
      const linkText = match[2];
      const linkUrl = match[3];
      const isInternal = linkUrl.startsWith('/') || linkUrl.startsWith('#');
      if (isInternal) {
        nodes.push(
          <Link
            key={match.index}
            href={linkUrl}
            className="text-primary font-medium hover:underline focus:outline-hidden focus:ring-2 focus:ring-primary/40 rounded-xs"
          >
            {linkText}
          </Link>
        );
      } else {
        nodes.push(
          <a
            key={match.index}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium hover:underline focus:outline-hidden focus:ring-2 focus:ring-primary/40 rounded-xs"
          >
            {linkText}
          </a>
        );
      }
    } else if (match[4]) {
      // **bold**
      nodes.push(
        <strong key={match.index} className="font-semibold text-on-background">
          {renderInline(match[4])}
        </strong>
      );
    } else if (match[5]) {
      // `code`
      nodes.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 rounded-md bg-surface-container text-xs font-mono text-primary"
        >
          {match[5]}
        </code>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const blocks = content.split(/\n\n+/);
  const headings = new Map(articleHeadings(content).map(h=>[h.blockIndex,h.id]));

  return (
    <div className="prose prose-neutral max-w-none space-y-5 text-on-surface leading-relaxed text-sm sm:text-base">
      {blocks.map((block, idx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Headings
        if (trimmed.startsWith('## ')) {
          const title = trimmed.replace(/^##\s+/, '');
          return (
            <h2
              id={headings.get(idx)}
              style={{scrollMarginTop:100}}
              key={idx}
              className="text-xl sm:text-2xl font-serif font-bold text-on-background pt-6 pb-1 border-b border-outline-variant/40"
            >
              {renderInline(title)}
            </h2>
          );
        }

        if (trimmed.startsWith('### ')) {
          const title = trimmed.replace(/^###\s+/, '');
          return (
            <h3
              id={headings.get(idx)}
              style={{scrollMarginTop:100}}
              key={idx}
              className="text-lg sm:text-xl font-bold text-on-background pt-4 pb-1"
            >
              {renderInline(title)}
            </h3>
          );
        }

        // Blockquotes / Callout notes
        if (trimmed.startsWith('>')) {
          const lines = trimmed
            .split('\n')
            .map((line) => line.replace(/^>\s?/, ''))
            .join('\n');
          return (
            <blockquote
              key={idx}
              className="my-4 rounded-2xl border-l-4 border-primary bg-primary/5 p-4 sm:p-5 text-sm sm:text-base text-on-surface italic space-y-2"
            >
              {lines.split('\n\n').map((para, pIdx) => (
                <p key={pIdx}>{renderInline(para)}</p>
              ))}
            </blockquote>
          );
        }

        // Unordered lists
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const items = trimmed.split('\n').filter((l) => l.trim().startsWith('- ') || l.trim().startsWith('* '));
          return (
            <ul key={idx} className="space-y-2 my-3 pl-5 list-disc marker:text-primary">
              {items.map((item, itemIdx) => {
                const text = item.replace(/^[-*]\s+/, '');
                return (
                  <li key={itemIdx} className="pl-1">
                    {renderInline(text)}
                  </li>
                );
              })}
            </ul>
          );
        }

        // Ordered lists
        if (/^\d+\.\s/.test(trimmed)) {
          const items = trimmed.split('\n').filter((l) => /^\d+\.\s/.test(l.trim()));
          return (
            <ol key={idx} className="space-y-2 my-3 pl-5 list-decimal marker:text-primary font-medium">
              {items.map((item, itemIdx) => {
                const text = item.replace(/^\d+\.\s+/, '');
                return (
                  <li key={itemIdx} className="pl-1 font-normal text-on-surface">
                    {renderInline(text)}
                  </li>
                );
              })}
            </ol>
          );
        }

        // Ordinary paragraph
        return (
          <p key={idx} className="text-on-surface leading-relaxed">
            {renderInline(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

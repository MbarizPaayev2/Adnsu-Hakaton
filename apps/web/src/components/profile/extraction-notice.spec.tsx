import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExtractionNotice, omittedItems } from './extraction-notice';

describe('ExtractionNotice', () => {
  it('says what is missing and what to do when the CV reader stopped at a limit', () => {
    render(<ExtractionNotice parsed={{ omitted: { workExperience: 3, skills: 7 } }} />);
    const text = screen.getByTestId('extraction-notice').textContent ?? '';
    expect(text).toMatch(/3 iş yeri, 7 bacarıq/);
    expect(text).toMatch(/əl ilə əlavə edin/);
  });
  it('shows nothing when nothing was left out (and for malformed values)', () => {
    const { container } = render(<ExtractionNotice parsed={{ workExperience: [] }} />);
    expect(container).toBeEmptyDOMElement();
    expect(omittedItems({ omitted: { workExperience: 0, education: 'x' } })).toEqual([]);
    expect(omittedItems(null)).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobsFilterForm, JobsFilterFormProps } from './jobs-filter-form';

const defaultProps: JobsFilterFormProps = {
  filters: {},
  categories: [
    { key: 'technology', label: 'IT və texnologiya', count: 42 },
    { key: 'finance', label: 'Maliyyə', count: 18 },
  ],
  sources: [
    { source: 'glorri', count: 50 },
    { source: 'smartjob', count: 10 },
  ],
  companies: [
    { company: 'PASHA Bank', count: 12 },
    { company: 'Kapital Bank', count: 8 },
  ],
  workArrangements: [
    { value: 'Remote', count: 15 },
    { value: 'Hybrid', count: 20 },
  ],
  experienceLevels: [
    { value: 'Junior', count: 10 },
    { value: 'Senior', count: 25 },
  ],
  activeCount: 0,
};

describe('JobsFilterForm filter hierarchy and collapsible behavior', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    window.innerWidth = 1024;
  });

  afterEach(() => {
    window.innerWidth = originalInnerWidth;
  });

  it('renders primary row controls and collapsed advanced filters by default', () => {
    const { container } = render(<JobsFilterForm {...defaultProps} />);

    // Primary row is directly available
    expect(screen.getByLabelText('Vəzifə və ya şirkət')).toBeInTheDocument();
    expect(screen.getByLabelText('Şirkət')).toBeInTheDocument();
    expect(screen.getByLabelText('Kateqoriya')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Axtar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sıfırla' })).toHaveAttribute('href', '/jobs');

    // Advanced filters button collapsed by default
    const advancedBtn = screen.getByRole('button', { name: /Əlavə filtrlər/ });
    expect(advancedBtn).toHaveAttribute('aria-expanded', 'false');

    const panel = container.querySelector('#' + advancedBtn.getAttribute('aria-controls'));
    expect(panel?.className).toContain('hidden');
  });

  it('toggles advanced filters open and closed on button click', () => {
    const { container } = render(<JobsFilterForm {...defaultProps} />);
    const advancedBtn = screen.getByRole('button', { name: /Əlavə filtrlər/ });

    // Open
    fireEvent.click(advancedBtn);
    expect(advancedBtn).toHaveAttribute('aria-expanded', 'true');
    const panel = container.querySelector('#' + advancedBtn.getAttribute('aria-controls'));
    expect(panel?.className).toContain('block');

    // Close
    fireEvent.click(advancedBtn);
    expect(advancedBtn).toHaveAttribute('aria-expanded', 'false');
    expect(panel?.className).toContain('hidden');
  });

  it('auto-opens advanced filters on desktop when an advanced filter is active', () => {
    window.innerWidth = 1024;
    render(
      <JobsFilterForm
        {...defaultProps}
        filters={{ location: 'Bakı', work: 'Hybrid' }}
        activeCount={2}
      />
    );

    const advancedBtn = screen.getByRole('button', { name: /Əlavə filtrlər/ });
    expect(advancedBtn).toHaveAttribute('aria-expanded', 'true');
    expect(advancedBtn).toHaveTextContent('2');
  });

  it('stays collapsed on phones even when an advanced filter is active', () => {
    window.innerWidth = 390;
    render(
      <JobsFilterForm
        {...defaultProps}
        filters={{ location: 'Gəncə' }}
        activeCount={1}
      />
    );

    const advancedBtn = screen.getByRole('button', { name: /Əlavə filtrlər/ });
    expect(advancedBtn).toHaveAttribute('aria-expanded', 'false');
    expect(advancedBtn).toHaveTextContent('1');
  });

  it('preserves existing filter values across both primary and advanced fields', () => {
    render(
      <JobsFilterForm
        {...defaultProps}
        filters={{
          q: 'mühasib',
          company: 'PASHA Bank',
          category: 'finance',
          location: 'Bakı',
          work: 'Hybrid',
          experience: 'Senior',
          source: 'glorri',
          sort: 'oldest',
        }}
        activeCount={8}
      />
    );

    expect(screen.getByLabelText('Vəzifə və ya şirkət')).toHaveValue('mühasib');
    expect(screen.getByLabelText('Şirkət')).toHaveValue('PASHA Bank');
    expect(screen.getByLabelText('Kateqoriya')).toHaveValue('finance');
    expect(screen.getByLabelText('Şəhər')).toHaveValue('Bakı');
    expect(screen.getByLabelText('İş formatı')).toHaveValue('Hybrid');
    expect(screen.getByLabelText('Təcrübə səviyyəsi')).toHaveValue('Senior');
    expect(screen.getByLabelText('Mənbə')).toHaveValue('glorri');
    expect(screen.getByLabelText('Sıralama')).toHaveValue('oldest');
  });

  it('renders a GET form targeting /jobs without embedding page parameter', () => {
    const { container } = render(<JobsFilterForm {...defaultProps} />);
    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/jobs');
    expect(form?.querySelector('[name="page"]')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VacancyForm, type VacancyFormValues } from './vacancy-form';

const mockPush = vi.fn();
const mockBack = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

describe('VacancyForm', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders form groups with semantic sections and labels', () => {
    render(<VacancyForm mode="create" />);

    expect(screen.getByRole('heading', { name: 'Əsas məlumatlar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Maaş və müddət' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tələblər və təsvir' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Müraciət sualları' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Vakansiya başlığı/)).toBeInTheDocument();
  });

  it('shows error if title is whitespace only on submit', async () => {
    render(<VacancyForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/Vakansiya başlığı/), {
      target: { value: '   ' },
    });

    const submitBtn = screen.getByRole('button', { name: 'Yadda saxla' });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Vakansiya başlığı mütləqdir');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows error when minimum salary exceeds maximum salary', async () => {
    render(<VacancyForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/Vakansiya başlığı/), {
      target: { value: 'Frontend Developer' },
    });
    fireEvent.change(screen.getByLabelText(/Minimum maaş/), {
      target: { value: '3000' },
    });
    fireEvent.change(screen.getByLabelText(/Maksimum maaş/), {
      target: { value: '2000' },
    });

    const submitBtn = screen.getByRole('button', { name: 'Yadda saxla' });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Minimum maaş maksimum maaşdan böyük ola bilməz');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves entered values when submission fails on server', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Server bazasında xəta baş verdi' }), {
        status: 500,
      }),
    );

    render(<VacancyForm mode="create" />);

    const titleInput = screen.getByLabelText(/Vakansiya başlığı/);
    const locationInput = screen.getByLabelText(/Şəhər \/ Məkan/);
    const descInput = screen.getByLabelText(/Vəzifə haqqında ümumi təsvir/);

    fireEvent.change(titleInput, { target: { value: 'Senior Backend Engineer' } });
    fireEvent.change(locationInput, { target: { value: 'Gəncə' } });
    fireEvent.change(descInput, { target: { value: 'NestJS və Postgres üzrə mütəxəssis' } });

    const submitBtn = screen.getByRole('button', { name: 'Yadda saxla' });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Server bazasında xəta baş verdi');
    expect(titleInput).toHaveValue('Senior Backend Engineer');
    expect(locationInput).toHaveValue('Gəncə');
    expect(descInput).toHaveValue('NestJS və Postgres üzrə mütəxəssis');
  });

  it('disables question inputs and omits questions from payload when hasApplications is true', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'vac-1' }), { status: 200 }));

    const initialValues: VacancyFormValues = {
      title: 'Product Manager',
      description: 'Məhsul komandasını idarə etmək',
      responsibilities: 'Sprint planlaşdırması',
      requirements: '3 il təcrübə',
      skills: 'Agile, Scrum, Jira',
      experienceLevel: 'Middle',
      salaryMin: '2000',
      salaryMax: '3000',
      location: 'Bakı',
      workArrangement: 'Hybrid',
      employmentType: 'Full-time',
      deadline: '2026-11-01',
      questions: [
        { label: 'Neçə il idarəetmə təcrübəniz var?', type: 'SHORT_TEXT', required: true, options: [] },
      ],
    };

    render(
      <VacancyForm
        mode="edit"
        vacancyId="vac-1"
        initialValues={initialValues}
        hasApplications={true}
      />,
    );

    expect(screen.getByText('Müraciət sualları dondurulub')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sual əlavə et/ })).not.toBeInTheDocument();

    const questionInput = screen.getByLabelText('1-ci sualın mətni');
    expect(questionInput).toBeDisabled();

    // Change title and submit
    const titleInput = screen.getByLabelText(/Vakansiya başlığı/);
    fireEvent.change(titleInput, { target: { value: 'Lead Product Manager' } });

    const submitBtn = screen.getByRole('button', { name: 'Yadda saxla' });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/business/vacancies/vac-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringMatching(/"title":"Lead Product Manager"/),
      }),
    );

    // Verify questions field was omitted from payload
    const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(calledBody.questions).toBeUndefined();
    expect(calledBody.title).toBe('Lead Product Manager');
    expect(mockPush).toHaveBeenCalledWith('/business/vacancies');
  });

  it('locks questions and says why when the application count is unknown (never assumes zero)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'vac-1' }), { status: 200 }));
    render(
      <VacancyForm
        mode="edit"
        vacancyId="vac-1"
        applicationsUnknown
        initialValues={{
          title: 'Analitik', description: 'Təsvir', responsibilities: '', requirements: '', skills: '', experienceLevel: 'Middle',
          salaryMin: '', salaryMax: '', location: 'Bakı', workArrangement: 'Onsite', employmentType: 'Full-time', deadline: '',
          questions: [{ label: 'Təcrübəniz?', type: 'SHORT_TEXT', required: true, options: [] }],
        }}
      />,
    );
    expect(screen.getByText(/müraciətlərin sayı yüklənmədi/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sual əlavə et/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('1-ci sualın mətni')).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).questions).toBeUndefined();
  });

  it('handles 409 conflict with an informative Azerbaijani explanation', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Müraciətlər olan vakansiyanın sualları dəyişdirilə bilməz' }), {
        status: 409,
      }),
    );

    render(
      <VacancyForm
        mode="edit"
        vacancyId="vac-2"
        initialValues={{
          title: 'QA Engineer',
          description: '',
          responsibilities: '',
          requirements: '',
          skills: '',
          experienceLevel: 'Junior',
          salaryMin: '',
          salaryMax: '',
          location: '',
          workArrangement: 'On-site',
          employmentType: 'Full-time',
          deadline: '',
          questions: [{ label: 'Selenium bilirsinizmi?', type: 'SHORT_TEXT', required: false, options: [] }],
        }}
        hasApplications={false}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Yadda saxla' });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bu vakansiyaya artıq müraciət daxil olduğu üçün sualları dəyişmək mümkün deyil');
  });
});

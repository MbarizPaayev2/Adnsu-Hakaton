import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MotivationProposals } from './motivation-proposals';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => api(...args) }));
const proposals = [{ id: 'role', field: 'whyRole', title: 'Vəzifəyə maraq', text: 'SQL ilə hesabatlar hazırlamaq istəyirəm.' }];
it('offers full editable sentences without adopting them until the candidate confirms', async () => {
  api.mockResolvedValue({ ok: true, json: async () => ({ motivationSuggestions: proposals }) });
  const adopt = vi.fn();
  render(<MotivationProposals matchId="job" language="az" values={{}} onAdopt={adopt} />);
  const input = await screen.findByLabelText('Vəzifəyə maraq');
  expect(adopt).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'SQL təcrübəmi ödəniş məlumatlarının təhlilinə tətbiq etmək istəyirəm.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Məni ifadə edir — əlavə et' }));
  expect(adopt).toHaveBeenCalledWith('whyRole', 'SQL təcrübəmi ödəniş məlumatlarının təhlilinə tətbiq etmək istəyirəm.');
});
it('blocks acceptance of a motivation template until the candidate fills their own reason', async () => {
  const prompted = [{ ...proposals[0], text: 'Bu tapşırığa marağımın səbəbi: [öz səbəbinizi yazın].' }];
  api.mockResolvedValue({ ok: true, json: async () => ({ motivationSuggestions: prompted }) });
  const adopt = vi.fn();
  render(<MotivationProposals matchId="prompted" language="az" values={{}} onAdopt={adopt} />);
  const input = await screen.findByLabelText('Vəzifəyə maraq');
  const accept = screen.getByRole('button', { name: 'Məni ifadə edir — əlavə et' });
  expect(accept).toBeDisabled();
  expect(screen.getByRole('note')).toHaveTextContent('öz həqiqi səbəbinizlə əvəz etmədən');
  fireEvent.change(input, { target: { value: 'Bu tapşırıq mənə maraqlıdır, çünki datadan düzgün qərarlar çıxarmağı sevirəm.' } });
  expect(accept).toBeEnabled();
  fireEvent.click(accept);
  expect(adopt).toHaveBeenCalledWith('whyRole', 'Bu tapşırıq mənə maraqlıdır, çünki datadan düzgün qərarlar çıxarmağı sevirəm.');
});
it('does not overwrite a candidate answer and discards stale vacancy responses', async () => {
  let resolveOld: (v: unknown) => void = () => {};
  api.mockImplementation((url: string) => url.includes('/old/') ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ motivationSuggestions: proposals }) }));
  const adopt = vi.fn();
  const { rerender } = render(<MotivationProposals matchId="old" language="az" values={{ whyRole: 'My own reason' }} onAdopt={adopt} />);
  rerender(<MotivationProposals matchId="new" language="az" values={{ whyRole: 'My own reason' }} onAdopt={adopt} />);
  await screen.findByRole('button', { name: 'Cavabımı bununla əvəz et' });
  resolveOld({ ok: true, json: async () => ({ motivationSuggestions: [{ ...proposals[0], text: 'Old vacancy' }] }) });
  await waitFor(() => expect(screen.queryByDisplayValue('Old vacancy')).not.toBeInTheDocument());
  expect(adopt).not.toHaveBeenCalled();
});

it('browses alternatives, retains edits and displays guidance without changing an answer', async () => {
  api.mockResolvedValue({ok:true,json:async()=>({motivationSuggestions:[
    {...proposals[0], sourceText:'SQL hesabatları', tip:'Bir real nümunə seçin.'},
    {...proposals[0], id:'role2', text:'Məlumat keyfiyyətini yoxlamaq istəyirəm.'},
  ],motivationGuidance:[{field:'gaps',tip:'CRM təcrübənizi dəqiqləşdirin.'}]})});
  const adopt=vi.fn();
  render(<MotivationProposals matchId="variants" language="az" values={{whyRole:'Öz səbəbim'}} onAdopt={adopt}/>);
  const first=await screen.findByLabelText('Vəzifəyə maraq');
  fireEvent.change(first,{target:{value:'Redaktə edilmiş səbəbim.'}});
  fireEvent.click(screen.getByRole('button',{name:'Vəzifəyə maraq: başqa variant'}));
  expect(screen.getByLabelText('Vəzifəyə maraq')).toHaveValue('Məlumat keyfiyyətini yoxlamaq istəyirəm.');
  expect(adopt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Vəzifəyə maraq: başqa variant'}));
  expect(screen.getByLabelText('Vəzifəyə maraq')).toHaveValue('Redaktə edilmiş səbəbim.');
  fireEvent.click(screen.getByRole('button',{name:'Cavabımı bununla əvəz et'}));
  expect(adopt).toHaveBeenCalledWith('whyRole','Redaktə edilmiş səbəbim.');
  fireEvent.click(screen.getByText('Daha güclü məktub üçün tövsiyələr'));
  expect(screen.getByText('CRM təcrübənizi dəqiqləşdirin.')).toBeVisible();
  expect(screen.getByText('Bir real nümunə seçin.')).toBeVisible();
});

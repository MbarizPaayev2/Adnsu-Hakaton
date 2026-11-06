import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArticleTool } from './article-tool';
import { ArticleBrowser } from './article-browser';
import { getAllArticles } from '@/lib/blog/articles';
import { articleHeadings } from '@/lib/blog/headings';
import { MarkdownContent } from './markdown-content';

const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
let write:ReturnType<typeof vi.fn>;
beforeEach(()=>{write=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});});
afterEach(()=>{if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard);else Reflect.deleteProperty(navigator,'clipboard');vi.restoreAllMocks();});

describe('public career tools',()=>{
  it('keeps mid/senior ownership explicit and leaves unmeasured outcomes out of the CV', async()=>{
    render(<ArticleTool kind="impact"/>);
    expect(screen.getByRole('button',{name:'Nailiyyət bəndini köçür'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Hansı problem və ya ehtiyac var idi?'),{target:{value:'Hesabatların tərifləri fərqlənirdi'}});
    fireEvent.change(screen.getByLabelText('Şəxsən hansı qərarı verdiniz və ya işi gördünüz?'),{target:{value:'Vahid hesablama qaydası təklif etdim'}});
    fireEvent.change(screen.getByLabelText('Öz töhfəniz və komandanın işi — varsa'),{target:{value:'Qaydanı maliyyə komandası təsdiqlədi'}});
    fireEvent.click(screen.getByRole('button',{name:'Nailiyyət bəndini köçür'}));
    await waitFor(()=>expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0]).toBe('Vahid hesablama qaydası təklif etdim.\nMəsuliyyət sərhədi: Qaydanı maliyyə komandası təsdiqlədi.');
    expect(write.mock.calls[0][0]).not.toMatch(/%|rəhbərlik|Nəticə|Hazırlıq sualı/);
    expect((screen.getByLabelText('Müsahibə qeydi və qalan hazırlıq sualları') as HTMLTextAreaElement).value).toContain('hansı alternativi');
  });
  it('uses only the supplied senior outcome and verification without inventing causal attribution',()=>{
    render(<ArticleTool kind="impact"/>);
    fireEvent.change(screen.getByLabelText('Hansı problem və ya ehtiyac var idi?'),{target:{value:'Təkrar sorğular'}});
    fireEvent.change(screen.getByLabelText('Şəxsən hansı qərarı verdiniz və ya işi gördünüz?'),{target:{value:'İdempotentlik testlərini hazırladım'}});
    fireEvent.change(screen.getByLabelText('Müşahidə olunan nəticə — varsa'),{target:{value:'Sınaqda təkrar bildiriş qeydə alınmadı'}});
    fireEvent.change(screen.getByLabelText('Nəticəni necə yoxladınız? — varsa'),{target:{value:'Buraxılış ssenarisi ilə yoxladım'}});
    expect(screen.getByLabelText('CV üçün qısa nailiyyət bəndi')).toHaveValue('İdempotentlik testlərini hazırladım. Sınaqda təkrar bildiriş qeydə alınmadı.');
    expect((screen.getByLabelText('Müsahibə qeydi və qalan hazırlıq sualları') as HTMLTextAreaElement).value).toContain('Buraxılış ssenarisi ilə yoxladım.');
  });
  it('builds only user-supplied evidence and preserves project scope without adding suggested skills or metrics',async()=>{
    render(<ArticleTool kind="evidence"/>);
    expect(screen.getByRole('button',{name:'CV bəndini köçür'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Layihənin adı'),{target:{value:'Satış hesabatı'}});
    fireEvent.change(screen.getByLabelText('Şəxsən nə etdiniz?'),{target:{value:'Açıq məlumatları yoxlayıb hesabat hazırladım'}});
    fireEvent.change(screen.getByLabelText('Fəaliyyətin həqiqi növü'),{target:{value:'Tədris layihəsi'}});
    fireEvent.click(screen.getByRole('button',{name:'CV bəndini köçür'}));
    await waitFor(()=>expect(write).toHaveBeenCalledTimes(1));
    const text=write.mock.calls[0][0];
    expect(text).toContain('Satış hesabatı — Tədris layihəsi');
    expect(text).toContain('Açıq məlumatları yoxlayıb hesabat hazırladım.');
    expect(text).not.toMatch(/SQL|Power BI|\d|%/);
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Köçürüldü'));
  });
  it('reports clipboard failure without claiming success or losing the prepared text',async()=>{
    write.mockRejectedValue(new Error('blocked'));
    render(<ArticleTool kind="evidence"/>);
    fireEvent.change(screen.getByLabelText('Layihənin adı'),{target:{value:'Layihə'}});
    fireEvent.change(screen.getByLabelText('Şəxsən nə etdiniz?'),{target:{value:'Nəticələri yoxladım'}});
    fireEvent.click(screen.getByRole('button',{name:'CV bəndini köçür'}));
    await screen.findByText(/Köçürmək alınmadı/);
    expect((screen.getByLabelText('Sizin məlumatlarınızdan hazırlanan CV bəndi') as HTMLTextAreaElement).value).toContain('Nəticələri yoxladım');
  });
  it('creates a software application draft, preserves names and honours an exact employer subject without sending anything',async()=>{
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    render(<ArticleTool kind="email"/>);
    expect(screen.getByRole('button',{name:'Mətni köçür'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ad və soyad'),{target:{value:'Fizuli Hasanov'}});
    fireEvent.change(screen.getByLabelText('Rola aid gördüyünüz bir real iş'),{target:{value:'Kurs layihəsində API üçün səhv ssenarilərini yoxladım'}});
    fireEvent.click(screen.getByText('Elan xüsusi mövzu sətri tələb edirsə'));
    fireEvent.change(screen.getByLabelText('Elanın tələb etdiyi mövzu'),{target:{value:'REF-2026-DEV'}});
    expect(screen.getByLabelText('E-poçtun mövzusu')).toHaveValue('REF-2026-DEV');
    fireEvent.click(screen.getByRole('button',{name:'Mətni köçür'}));
    await waitFor(()=>expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0]).toContain('Fizuli Hasanov');
    expect(write.mock.calls[0][0]).not.toContain('Fızuli');
    expect(write.mock.calls[0][0]).toContain('Kurs layihəsində');
    expect(write.mock.calls[0][0]).not.toContain('əlavə etmişəm');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects a non-web portfolio URL and resets copy feedback when the content changes',async()=>{
    render(<ArticleTool kind="email"/>);
    fireEvent.change(screen.getByLabelText('Ad və soyad'),{target:{value:'Aysel'}});
    fireEvent.change(screen.getByLabelText('Rola aid gördüyünüz bir real iş'),{target:{value:'API hazırladım'}});
    fireEvent.change(screen.getByLabelText('Açıq layihə keçidi — istəyə bağlı'),{target:{value:'javascript:alert(1)'}});
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button',{name:'Mətni köçür'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Açıq layihə keçidi — istəyə bağlı'),{target:{value:'https://github.com/example/project'}});
    fireEvent.click(screen.getByRole('button',{name:'Mətni köçür'}));
    await waitFor(()=>expect(write).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Elandakı vəzifə adı'),{target:{value:'Junior Frontend Developer'}});
    expect(screen.queryByText('Köçürüldü. Göndərməzdən əvvəl mətni yoxlayın.')).not.toBeInTheDocument();
  });
});

describe('guide discovery and stable article links',()=>{
  it('finds Azerbaijani topics using unaccented input and recovers from an empty search',()=>{
    render(<ArticleBrowser articles={getAllArticles()}/>);
    fireEvent.change(screen.getByLabelText('Sizə nə lazımdır?'),{target:{value:'musahibe'}});
    expect(screen.getByRole('status')).toHaveTextContent('2 məqalə');
    expect(screen.getByRole('heading',{name:/İş müsahibəsinə/})).toBeVisible();
    fireEvent.change(screen.getByLabelText('Sizə nə lazımdır?'),{target:{value:'not-a-real-topic'}});
    fireEvent.click(screen.getByRole('button',{name:'Bütün məqalələri göstər'}));
    fireEvent.click(screen.getByRole('button',{name:'Junior+'}));
    expect(screen.getByRole('status')).toHaveTextContent('2 məqalə');
    fireEvent.click(screen.getByRole('button',{name:'Mid və senior'}));
    expect(screen.getByRole('status')).toHaveTextContent('1 məqalə');
    expect(screen.getByRole('heading',{name:/Mid və senior CV-si/})).toBeVisible();
  });
  it('uses identical, unique anchor ids in the contents and rendered article',()=>{
    const content='## CV necə yazılır?\n\nMətn.\n\n## CV necə yazılır?\n\nİkinci hissə.';
    const headings=articleHeadings(content);
    expect(headings.map(h=>h.id)).toEqual(['cv-nece-yazilir','cv-nece-yazilir-2']);
    render(<MarkdownContent content={content}/>);
    expect(document.getElementById(headings[1].id)).toHaveTextContent('CV necə yazılır?');
  });
});

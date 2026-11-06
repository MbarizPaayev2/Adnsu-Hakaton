import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { ShareImage } from '@/components/blog/share-image';
import { getArticleBySlug } from '@/lib/blog/articles';
export const alt='AISE — Azərbaycan dilində praktik karyera bələdçisi';
export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const article=getArticleBySlug(slug);if(!article)notFound();return new ImageResponse(<ShareImage title={article.title} subtitle={article.tool?'İnteraktiv alət · Qeydiyyatsız sına':'Praktik nümunələr və yoxlama siyahısı'}/>,size);}

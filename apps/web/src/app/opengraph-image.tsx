import { ImageResponse } from 'next/og';
import { ShareImage } from '@/components/blog/share-image';
export const alt='AISE — iş axtarışı və müraciət köməkçisi';
export const size={width:1200,height:630};
export const contentType='image/png';
export default function Image(){return new ImageResponse(<ShareImage title="İş axtarışı və müraciət köməkçin." subtitle="Vakansiyalar, fərdi sənədlər və müraciətlərin izlənməsi."/>,size);}

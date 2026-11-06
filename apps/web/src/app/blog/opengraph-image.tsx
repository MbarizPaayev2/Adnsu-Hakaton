import { ImageResponse } from 'next/og';
import { ShareImage } from '@/components/blog/share-image';
export const alt='AISE karyera bələdçiləri və interaktiv alətlər';
export const size={width:1200,height:630};
export const contentType='image/png';
export default function Image(){return new ImageResponse(<ShareImage title="CV, müsahibə və karyera bələdçiləri."/>,size);}

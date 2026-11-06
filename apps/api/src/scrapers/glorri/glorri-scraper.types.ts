export interface GlorriJobSummary {
  title: string;
  slug: string;
  postedDate?: string;
  isRemote?: boolean;
  jobFunction?: string;
  careerLevel?: string;
  location?: string;
  viewCount?: number;
  type?: string;
  isProAd?: boolean;
  company?: {
    slug: string;
    name: string;
    logo?: string;
  };
}

export interface GlorriJobDetail {
  title: string | null;
  company_name: string | null;
  location: string | null;
  employment_type: string | null;
  description_html: string | null;
  description_text: string | null;
  requirements_html: string | null;
  requirements_text: string | null;
  sidebar: Record<string, string>;
  deadline?: string;
  posted_date_display?: string;
  category: string | null;
}

export interface GlorriJobRecord extends GlorriJobSummary {
  detail?: GlorriJobDetail;
}

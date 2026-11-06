import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { CookieConsent } from "@/components/cookie-consent";
import { GoogleAnalytics } from "@/components/google-analytics";
import { PreviewBanner } from "@/components/preview-banner";

export const metadata: Metadata = {
  metadataBase: new URL("https://aisehr.com"),
  title: "AISE — Müraciət köməkçisi",
  description:
    "AISE uyğun vakansiyaları tapır, təsdiqlədiyiniz faktlarla müraciət hazırlayır, sizin təsdiqinizlə göndərir və müraciətlərinizi bir yerdə izləyir.",
  openGraph: {
    title: "AISE — Müraciət köməkçisi",
    description:
      "Azərbaycandakı vakansiyalar, elana uyğun CV və məktub, sizin təsdiqinizlə göndəriş və müraciət cədvəli.",
    locale: "az_AZ",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning on <html>: the inline script in <body> adds the
  // `js-reveal` class to the document element before React hydrates. Running
  // it that early is the point — it has to beat first paint — but it means the
  // server-rendered class list and the client's differ, which React otherwise
  // reports as a hydration mismatch. Scoped to this one element.
  return (
    <html lang="az" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({
          '@context':'https://schema.org','@graph':[
            {'@type':'Organization','@id':'https://aisehr.com/#organization',name:'AISE',url:'https://aisehr.com',logo:'https://aisehr.com/logo.png'},
            {'@type':'WebSite','@id':'https://aisehr.com/#website',name:'AISE',url:'https://aisehr.com',inLanguage:'az-AZ',publisher:{'@id':'https://aisehr.com/#organization'}}
          ]
        })}}/>

        {/* Fetched by the browser at runtime — see the comment at the top of
            globals.css for why these aren't a CSS @import instead. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Inter for all text; Source Serif 4 italic (one weight) only for the
            accent phrases in landing headings (--font-accent in globals.css).
            Both cover every Azerbaijani letter, including ə. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Source+Serif+4:ital,opsz,wght@1,8..60,400&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {/*
          Marks the document as script-capable BEFORE first paint, which is
          what lets globals.css scope the reveal-on-scroll hidden state to
          `html.js-reveal`. Inline and blocking on purpose: if this ran later
          (or not at all) the content would either flash visible-then-hidden,
          or — when the reveal code fails to run — stay hidden forever.
          Keep it dependency-free and synchronous.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('js-reveal')`,
          }}
        />
        <Providers>
          <PreviewBanner />
          {children}
          <CookieConsent />
          <GoogleAnalytics />
        </Providers>
      </body>
    </html>
  );
}

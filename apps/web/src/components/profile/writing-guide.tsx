import React from 'react';

/**
 * How to describe experience: what I did + how (method, tool, context) + what came of it, when there is evidence. Numbers are optional and never
 * invented; coursework, projects and contributions count when there is no employment history. Shown on onboarding and the profile page.
 */
export function ExperienceWritingGuide({ id }: { id?: string }) {
  return (
    <div id={id} className="rounded-xl bg-primary/5 p-4 text-sm text-neutral-dark/80 space-y-2">
      <p className="font-semibold">Hər bənddə: nə etdim, necə etdim, nə alındı</p>
      <p>
        Öz dilinizlə, birinci şəxsdə yazın: “hazırladım”, “təhlil etdim”; davam edən iş üçün “edirəm”. Nəticəni yalnız sübutu varsa yazın.
        Rəqəm məcburi deyil.
      </p>
      <details>
        <summary className="cursor-pointer font-medium text-primary">Nümunələr və qaydalar</summary>
        <div className="mt-2 space-y-2">
          <p>Rəqəmlə: “Həftəlik satış hesabatını Excel-də avtomatlaşdırdım; hazırlanma müddəti 3 saatdan 1 saata endi.”</p>
          <p>Rəqəmsiz: “Müştəri sorğularını mövzular üzrə qruplaşdırdım və komanda üçün vahid cavab siyahısı hazırladım.”</p>
          <p>İş təcrübəniz yoxdursa, kurs və layihələrinizi yazın: “Universitet kursunda 3 nəfərlik komandada kitabxana üçün veb tətbiq hazırladık; axtarış və qeydiyyat hissəsini React ilə mən yazdım.”</p>
          <p>Kurs işi: “Statistika kursunda açıq məlumat dəstini Python ilə təmizlədim və əsas nəticələri qısa hesabatda təqdim etdim.”</p>
          <p>
            Yalnız öz faktlarınızı yazın. Rəqəm uydurmayın. Komanda işində öz payınızı göstərin; iştirakı rəhbərlik, kursu dərəcə kimi təqdim
            etməyin.
          </p>
        </div>
      </details>
    </div>
  );
}

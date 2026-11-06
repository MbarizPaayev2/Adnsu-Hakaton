// @vitest-environment-options {"url":"https://jobs.glorri.az/vacancies/employer/role/apply"}
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The same function is serialized into Chrome's active tab; fixtures exercise normal employer form controls.
import { fillIdentity } from "../../../extension/lib/assisted-form.js";
import { prefillSummary } from "../../../extension/lib/prefill-summary.js";
beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 40,
  } as DOMRect);
});
describe("candidate-triggered identity assistance on Glorri and other employer forms", () => {
  const profile = {
    name: "Aysel Məmmədova",
    email: "candidate@example.com",
    phone: "+994501234567",
  };
  it("fills standard fields without clicking, uploading, ticking consent or changing answers", () => {
    document.body.innerHTML =
      '<form><label>Ad<input name="firstName"></label><label>Soyad<input name="lastName"></label><label>E-poçt<input type="email"></label><label>Telefon<input type="tel"></label><label>Company<input name="company"></label><input type="checkbox" required><input type="file"><button type="submit">Göndər</button></form>';
    const click = vi.fn();
    document.querySelector("button")!.addEventListener("click", click);
    const result = fillIdentity(profile);
    expect(location.protocol).toBe("https:");
    expect(result).toMatchObject({ ok: true, submitted: false });
    expect(
      (document.querySelector('[name="firstName"]') as HTMLInputElement).value,
    ).toBe("Aysel");
    expect(
      (document.querySelector('[name="lastName"]') as HTMLInputElement).value,
    ).toBe("Məmmədova");
    expect(
      (document.querySelector('[type="checkbox"]') as HTMLInputElement).checked,
    ).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
  it("leaves prefilled values, password forms, hidden fields and sensitive questions untouched", () => {
    document.body.innerHTML =
      '<form><input name="email" type="email" value="existing@example.com"><label>Company name<input></label><label>One-time code<input></label><input type="hidden" name="name"><label>Ad və soyad<input readonly></label></form><form><input type="password"><input type="email"></form>';
    expect(fillIdentity(profile).filled).toHaveLength(0);
    expect(
      (document.querySelector('[name="email"]') as HTMLInputElement).value,
    ).toBe("existing@example.com");
  });
  it("names what it filled, marks it on the page, and says what the profile lacks and what is still the candidate's to answer", () => {
    document.body.innerHTML =
      '<form><label>Ad<input name="firstName"></label><label>Soyad<input name="lastName"></label><label>Telefon<input type="tel"></label><label>Niyə bu vəzifə?<textarea required></textarea></label><label>Razıyam<input type="checkbox" required></label></form>';
    const result = fillIdentity({ name: "Aysel", email: "a@example.com", phone: "" });
    expect(result.filled).toEqual(["Ad"]);
    expect(result.missing).toEqual(expect.arrayContaining(["Soyad", "Telefon"]));
    expect(result.requiredLeft).toBe(2);
    expect((document.querySelector('[name="firstName"]') as HTMLInputElement).getAttribute("data-aise-filled")).toBe("first");
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    expect((document.querySelector('[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    const text = prefillSummary(result);
    expect(text).toContain("Dolduruldu: Ad");
    expect(text).toContain("Profilinizdə yoxdur: Soyad, Telefon");
    expect(text).toContain("2 məcburi sahə sizin cavabınızı gözləyir");
    expect(text).toContain("AISE heç nə göndərməyib");
  });
  it("recognises common Azerbaijani and English wordings through one table, not per-site code", () => {
    document.body.innerHTML =
      '<form><label>Adınız (məcburi)<input></label><label>Soyadınız *<input></label><label>E-poçt ünvanınız<input></label><label>Mobil nömrəniz<input></label></form>' +
      '<form><span id="l1">First name</span><input aria-labelledby="l1"><input name="last_name" placeholder="Doe"><input autocomplete="email"><input name="phone_number"></form>';
    const result = fillIdentity(profile);
    const values = [...document.querySelectorAll("input")].map((i) => (i as HTMLInputElement).value);
    expect(values).toEqual(["Aysel", "Məmmədova", "candidate@example.com", "+994501234567", "Aysel", "Məmmədova", "candidate@example.com", "+994501234567"]);
    expect(result.filled).toHaveLength(8);
  });
  it("never puts the candidate's details into a referee's, father's or emergency contact's fields", () => {
    document.body.innerHTML =
      '<form><label>Ata adı<input></label><label>Tövsiyəçinin e-poçtu<input type="email"></label><label>Referee phone<input type="tel"></label><label>Emergency contact name<input></label><label>Middle name<input></label></form>';
    expect(fillIdentity(profile).filled).toEqual([]);
    expect([...document.querySelectorAll("input")].every((i) => (i as HTMLInputElement).value === "")).toBe(true);
  });
  it("gives a phone box with its own +994 prefix only the national number", () => {
    document.body.innerHTML =
      '<form><label>Telefon<div class="phone"><span>+994</span><input type="tel" placeholder="50 123 45 67"></div></label><label>Mobile<input type="tel" placeholder="+994 50 123 45 67"></label></form>';
    fillIdentity(profile);
    const [national, full] = [...document.querySelectorAll("input")].map((i) => (i as HTMLInputElement).value);
    expect(national).toBe("501234567");
    expect(full).toBe("+994501234567");
  });
});


// Real jobs.glorri.az apply steps (structure saved from the live site on 17 Oct 2026, emptied of styling): apps/extension/test/fixtures/glorri.
describe("Glorri's real apply steps", () => {
  const profile = { name: "Aysel Məmmədova", email: "candidate@example.com", phone: "+994501234567" };
  const LETTER = "Yelo Bank-ın Data elmi üzrə təcrübəçi vakansiyasına müraciət edirəm.\n\nPython və SQL ilə layihələr hazırlamışam.";
  const load = (name: string) => {
    const html = readFileSync(join(__dirname, "../../../extension/test/fixtures/glorri", name), "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  };
  const value = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement).value;

  it("step 1 of a short form (Unibank): name, surname, e-mail and mobile number; CV and photo stay the candidate's", () => {
    load("step1-personal-unibank.html");
    const r = fillIdentity(profile);
    expect(r.filled).toEqual(["Ad", "Soyad", "E-poçt", "Telefon"]);
    expect([value("name.first"), value("name.last"), value("email"), value("phoneNumber")]).toEqual(["Aysel", "Məmmədova", "candidate@example.com", "+994501234567"]);
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].every((f) => !f.files?.length)).toBe(true);
    expect(r.submitted).toBe(false);
  });
  it("step 1 of a long form (Yelo Bank): father's name, address, salary, FIN code and LinkedIn are left for the candidate", () => {
    load("step1-personal-yelo.html");
    const r = fillIdentity(profile);
    expect(r.filled).toEqual(["Ad", "Soyad", "E-poçt", "Telefon"]);
    for (const n of ["name.father", "address", "salary", "nationalId.finCode", "linkedinLink"]) expect(value(n)).toBe("");
    // Ata adı, Faktiki ünvan, Min. maaş tələbi, Net/gross and FİN kod are required and still empty (Valyuta is preset to AZN by Glorri).
    expect(r.requiredLeft).toBe(5);
    expect(prefillSummary(r)).toContain("5 məcburi sahə sizin cavabınızı gözləyir");
  });
  it("the letter step gets the letter approved in AISE for this vacancy, and only when one exists", () => {
    load("step-letter-yelo.html");
    expect(fillIdentity({ ...profile, letter: LETTER })).toMatchObject({ filled: ["Motivasiya məktubu"], letterMissing: false, requiredLeft: 0 });
    expect(value("coverLetter")).toBe(LETTER);
    load("step-letter-yelo.html");
    const none = fillIdentity(profile);
    expect(none).toMatchObject({ filled: [], letterMissing: true, requiredLeft: 1 });
    expect(value("coverLetter")).toBe("");
    expect(prefillSummary(none)).toContain("təsdiqlənmiş motivasiya məktubu yoxdur");
  });
  it("never puts the candidate's details into the referee step, or the letter into experience descriptions", () => {
    load("step-recommenders-yelo.html");
    expect(fillIdentity(profile).filled).toEqual([]);
    for (const n of ["recommenders.0.firstName", "recommenders.0.lastName", "recommenders.0.email", "recommenders.0.phone"]) expect(value(n)).toBe("");
    load("step-experience-yelo.html");
    expect(fillIdentity({ ...profile, letter: LETTER }).filled).toEqual([]);
    expect(value("workExperiences.0.description")).toBe("");
  });
});

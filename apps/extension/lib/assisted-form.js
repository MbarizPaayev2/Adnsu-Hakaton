/**
 * Serialized by chrome.scripting into the candidate's chosen tab, so everything it uses is defined inside it. No network, file uploads, consent clicks or submission.
 * Fields are recognised by one reusable table (autocomplete token, label and control name, in Azerbaijani and English), not by per-site code.
 * profile.letter, when given, is the letter the candidate approved in AISE for this vacancy; it goes only into an empty motivation-letter box
 * (Glorri's second step, "Motivasiya məktubu"), never into experience, education or other free-text answers.
 */
export function fillIdentity(profile) {
  if (location.protocol !== "https:")
    return { ok: false, reason: "HTTPS səhifəsi lazımdır." };
  const fold = (s) =>
    String(s || "")
      .toLocaleLowerCase("az")
      .replace(/ə/g, "e")
      .replace(/ı/g, "i")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ç/g, "c")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .replace(/[_-]/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // Words that only say whether a field is required ("Ad (məcburi)", "Email *") do not change what it asks for.
  const core = (s) => fold(s).replace(/\b(required|optional|mecburi|zeruri|isteye bagli)\b/g, " ").replace(/\s+/g, " ").trim();
  const parts = String(profile.name || "")
    .trim()
    .split(/\s+/);
  const nationalPhone = String(profile.phone || "").replace(/[\s()-]/g, "").replace(/^\+994/, "").replace(/^0/, "");
  // kind → which autocomplete tokens, labels and control names mean it. Labels are compared whole (after folding), so "Ata adı" is not "Ad".
  const RULES = [
    { kind: "first", auto: ["given-name"], label: /^(first name|firstname|given name|your first name|ad|adi|adiniz)$/, name: /^(first ?name|fname|given ?name)$/ },
    { kind: "last", auto: ["family-name"], label: /^(last name|lastname|surname|family name|your last name|soyad|soyadi|soyadiniz)$/, name: /^(last ?name|lname|surname|family ?name)$/ },
    { kind: "full", auto: ["name"], label: /^(full name|fullname|name|your name|your full name|name and surname|name surname|ad soyad|ad ve soyad|ad soyadiniz|adiniz soyadiniz|adiniz ve soyadiniz|tam ad|tam adiniz)$/, name: /^(full ?name|name|applicant ?name|candidate ?name)$/ },
    { kind: "email", auto: ["email"], type: "email", label: /^(email|e mail|your email|email address|e mail address|e poct|e poct unvani|e poct unvaniniz|elektron poct|elektron poct unvani|elektron poct unvaniniz)$/, name: /^(email|e mail|email ?address|mail)$/ },
    { kind: "phone", auto: ["tel", "tel-national"], type: "tel", label: /^(phone|phone number|your phone|mobile|mobile phone|mobile number|telephone|contact number|telefon|telefon nomresi|telefon nomreniz|mobil|mobil nomre|mobil nomreniz|mobil telefon|elaqe nomresi|elaqe telefonu)$/, name: /^(phone|phone ?number|mobile|mobile ?phone|tel|telephone|msisdn)$/ },
  ];
  // Someone else's details (a referee: Glorri names them recommenders.N.firstName under the same "Ad" label, an emergency contact), a company, codes and search boxes are never the candidate's identity.
  const NOT_IDENTITY = /company|employer|is yeri|sirket|otp|password|parol|kod|code|search|axtar|refer|recommend|tovsiye|emergency|tecili|ata adi|father|patronymic|middle name/;
  const filled = [];
  // Fields this tool fills, said in the candidate's words; and profile facts it could not use because the profile lacks them.
  const KIND = { first: "Ad", last: "Soyad", full: "Ad və soyad", email: "E-poçt", phone: "Telefon" };
  const missing = new Set();
  const labelText = (input) => {
    const byId = (input.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => id && document.getElementById(id)?.textContent).filter(Boolean).join(" ");
    return input.labels?.[0]?.textContent || input.getAttribute("aria-label") || byId || input.placeholder || input.name;
  };
  // A phone box with its own fixed "+994" prefix next to it wants the national number only.
  const hasCountryPrefix = (input) => {
    if (String(input.placeholder || "").trim().startsWith("+")) return false;
    for (let el = input.parentElement, i = 0; el && i < 2; el = el.parentElement, i++) {
      const outside = [...el.childNodes].filter((n) => n !== input && !n.contains?.(input)).map((n) => n.textContent || "").join(" ");
      if (/\+\s?994/.test(outside)) return true;
    }
    return false;
  };
  for (const input of document.querySelectorAll("input")) {
    const form = input.closest("form");
    if (form?.querySelector('input[type="password"]')) continue;
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    if (
      input.disabled ||
      input.readOnly ||
      rect.width === 0 ||
      rect.height === 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      !["text", "email", "tel"].includes(input.type)
    )
      continue;
    const label = core(labelText(input));
    const name = core(input.name);
    if (NOT_IDENTITY.test(`${label} ${name} ${fold(input.id)}`)) continue;
    const auto = String(input.autocomplete || "").toLowerCase();
    const rule =
      RULES.find((r) => r.auto.includes(auto)) ||
      RULES.find((r) => r.label.test(label)) ||
      RULES.find((r) => r.name.test(name)) ||
      RULES.find((r) => r.type && r.type === input.type);
    if (!rule) continue;
    const kind = rule.kind;
    // Mask scaffolding ("(__) ___-__-__", or a country prefix alone) is not a candidate-entered number.
    // Real or partially typed digits remain untouched, including incomplete phone numbers.
    const emptyPhoneMask = kind === "phone" && (
      /^[\s+()_\-./\u200e\u200f]*$/.test(input.value) ||
      /^\+994[\s()_\-./\u200e\u200f]*$/.test(input.value)
    );
    if (input.value.trim() && !emptyPhoneMask) continue;
    let value =
      kind === "first" ? parts[0] || ""
      : kind === "last" ? (parts.length > 1 ? parts.slice(1).join(" ") : "")
      : kind === "full" ? profile.name
      : kind === "email" ? profile.email
      : profile.phone;
    if (kind === "phone" && value && nationalPhone && (auto === "tel-national" || hasCountryPrefix(input))) value = nationalPhone;
    if (!value) {
      missing.add(KIND[kind]);
      continue;
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // Marked on the page so the candidate can see exactly what changed before deciding anything.
    input.style.outline = "2px solid #4f7a35";
    input.style.outlineOffset = "2px";
    input.setAttribute("data-aise-filled", kind);
    filled.push(KIND[kind]);
  }
  // The letter step: only a box that plainly asks for a motivation or cover letter, and only when it is empty.
  const LETTER_LABEL = /^(motivasiya mektubu|motivasiya mektubunuz|muraciet mektubu|cover letter|motivation letter|your cover letter)$/;
  const LETTER_NAME = /^(cover ?letter|motivation ?letter)$/;
  let letterMissing = false;
  for (const box of document.querySelectorAll("textarea")) {
    const r = box.getBoundingClientRect();
    if (box.disabled || box.readOnly || box.value.trim() || r.width === 0 || r.height === 0) continue;
    if (!LETTER_LABEL.test(core(labelText(box))) && !LETTER_NAME.test(core(box.name))) continue;
    const text = String(profile.letter || "").trim();
    if (!text) {
      letterMissing = true;
      continue;
    }
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
    box.style.outline = "2px solid #4f7a35";
    box.style.outlineOffset = "2px";
    box.setAttribute("data-aise-filled", "letter");
    filled.push("Motivasiya məktubu");
  }
  // Required questions the candidate still has to answer themselves (never filled, guessed or ticked here).
  let requiredLeft = 0;
  for (const el of document.querySelectorAll("input[required], select[required], textarea[required], [aria-required='true']")) {
    if (el.type === "hidden" || el.disabled || el.hasAttribute("data-aise-filled")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const empty = el.type === "checkbox" || el.type === "radio" ? !el.checked : !String(el.value || "").trim();
    if (empty) requiredLeft++;
  }
  return { ok: true, filled, missing: [...missing], letterMissing, requiredLeft, submitted: false };
}

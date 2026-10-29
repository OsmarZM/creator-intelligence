import type { Creator } from "./types";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
/** Match complete registered names/handles, never fuzzy-match someone else's data. */
export function mentionedCreators(text: string, creators: Creator[]) {
  const normalized = normalize(text);
  return creators.filter((creator) => {
    const name = normalize(creator.name).replace(/^@/, "");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_.-])@?${escaped}(?=$|[^\\p{L}\\p{N}_.-])`,
      "u",
    ).test(normalized);
  });
}
export function creatorContext(
  text: string,
  creators: Creator[],
  selectedId?: string,
) {
  const matches = mentionedCreators(text, creators);
  const selected = creators.find((c) => c.id === selectedId);
  if (
    !selected &&
    !matches.length &&
    /\b(ele|ela|esse criador|essa criadora|este criador|esse creator|deste creator|desse creator|este perfil|esse perfil)\b/.test(
      normalize(text),
    )
  )
    return { needsChoice: true, creator: undefined };
  if (
    matches.length > 1 ||
    (matches.length === 1 && selected && matches[0].id !== selected.id)
  )
    return { needsChoice: true, creator: undefined };
  return { needsChoice: false, creator: matches[0] ?? selected };
}
export function isDataQuestion(text: string) {
  return (
    /\?\s*$/.test(text.trim()) ||
    /^(oi\b|ola\b|bom dia\b|boa tarde\b|boa noite\b|qual\b|quais\b|como\b|por que\b|porque\b|pode\b|voce\b|me (ajud|expli)|resum|compar|analis|o que\b)/i.test(
      normalize(text.trim()),
    )
  );
}

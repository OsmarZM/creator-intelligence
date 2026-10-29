/** Character ceilings are conservative operational budgets, not exact tokenizer counts. */
export function splitText(text: string, limit = 5000): string[] {
  const result: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let end = remaining.lastIndexOf("\n", limit);
    if (end < limit / 2) end = remaining.lastIndexOf(" ", limit);
    if (end < limit / 2) end = limit;
    // Never split UTF-16 surrogate pairs.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1] ?? "")) end--;
    result.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) result.push(remaining);
  if (result.length > 48)
    throw new Error(
      "O texto exige mais de 48 blocos. Separe-o em dois envios.",
    );
  return result;
}
export function sampleText(text: string, limit = 5000) {
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.floor(limit * 0.7))}\n[trecho intermediário preservado no original]\n${text.slice(-Math.floor(limit * 0.25))}`;
}
export function boundedJSON(value: unknown, limit: number) {
  const result = JSON.stringify(value);
  if (result.length > limit)
    throw new Error(
      "Contexto acima do orçamento desta etapa. Reduza o período ou divida a pergunta.",
    );
  return result;
}

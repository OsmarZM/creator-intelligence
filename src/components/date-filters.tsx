"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { dateSchema } from "@/lib/domain";
type Period = { from: string; to: string };
function valid(period: Period) {
  return (
    dateSchema.safeParse(period.from).success &&
    dateSchema.safeParse(period.to).success &&
    period.from <= period.to &&
    (Date.parse(period.to) - Date.parse(period.from)) / 86400000 <= 1096
  );
}
export default function DateFilters({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  const [draft, setDraft] = useState<Period | null>(null),
    [error, setError] = useState(false);
  const shown = draft ?? period;
  function change(field: "from" | "to", value: string) {
    const next = { ...shown, [field]: value };
    setDraft(next);
    setError(false);
    if (valid(next)) onChange(next);
  }
  return (
    <div className="date-filter-group">
      <div
        className="date-filters"
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          if (!draft) return;
          if (valid(draft)) {
            setDraft(null);
            setError(false);
          } else setError(true);
        }}
      >
        <input
          aria-label="Data inicial"
          type="date"
          value={shown.from}
          aria-invalid={error}
          onChange={(event) => change("from", event.target.value)}
        />
        <ArrowRight size={12} />
        <input
          aria-label="Data final"
          type="date"
          value={shown.to}
          aria-invalid={error}
          onChange={(event) => change("to", event.target.value)}
        />
      </div>
      {error && (
        <small role="alert" className="date-filter-error">
          Complete as datas em ordem, com intervalo de até 3 anos.{" "}
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setError(false);
            }}
          >
            Restaurar período
          </button>
        </small>
      )}
    </div>
  );
}

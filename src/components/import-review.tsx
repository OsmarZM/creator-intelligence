"use client";
import { useState } from "react";
import { Check, FileSpreadsheet, X } from "lucide-react";
import type { ImportBatch } from "@/lib/types";
import { Button } from "./ui/button";
const labels: Record<string, string> = {
  new: "Novo",
  update: "Correção",
  duplicate: "Duplicado",
  invalid: "Incompleto/inválido",
  conflict: "Conflito",
};
export default function ImportReview({
  batch,
  onClose,
  onConfirm,
  busy,
  creatorName,
}: {
  batch: ImportBatch;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  busy: boolean;
  creatorName?: string;
}) {
  const [selected, setSelected] = useState<string[]>(
    batch.changes.filter((c) => c.classification === "new").map((c) => c.id),
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">REVISÃO DE DADOS</span>
            <h2 id="review-title">
              <FileSpreadsheet size={20} /> {batch.filename}
            </h2>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Fechar revisão">
            <X size={18} />
          </Button>
        </div>
        <p className="notice">
          Destino dos dados: <strong>{creatorName ?? batch.creatorId}</strong>
        </p>
        <p className="muted">
          Revise as propostas. Correções precisam ser selecionadas
          explicitamente. Somente as linhas marcadas serão gravadas.
        </p>
        {batch.interpretation && (
          <p className="notice">{batch.interpretation}</p>
        )}
        <div className="review-counts">
          {Object.entries(labels).map(([key, label]) => (
            <span key={key} className={`tag ${key}`}>
              {batch.changes.filter((c) => c.classification === key).length}{" "}
              {label}
            </span>
          ))}
        </div>
        <div className="review-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Selecionar" />
                <th>Linha</th>
                <th>Situação</th>
                <th>Dados e origem</th>
              </tr>
            </thead>
            <tbody>
              {batch.changes.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      aria-label={`Aprovar linha ${c.row}`}
                      type="checkbox"
                      disabled={
                        batch.status !== "pending" ||
                        !["new", "update"].includes(c.classification)
                      }
                      checked={selected.includes(c.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, c.id]
                            : selected.filter((id) => id !== c.id),
                        )
                      }
                    />
                  </td>
                  <td>{c.row}</td>
                  <td>
                    <span className={`tag ${c.classification}`}>
                      {labels[c.classification]}
                    </span>
                  </td>
                  <td>
                    <div className="record-fields">
                      {Object.entries(c.payload).map(([k, v]) => (
                        <span key={k}>
                          <b>{k}</b> {String(v)}
                        </span>
                      ))}
                    </div>
                    {c.previous && c.classification === "update" && (
                      <details>
                        <summary>Ver registro anterior</summary>
                        <pre>{JSON.stringify(c.previous, null, 2)}</pre>
                      </details>
                    )}
                    {c.reason && <small className="muted">{c.reason}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <span className="muted">
            {selected.length} de {batch.changes.length} selecionados ·{" "}
            {batch.status}
          </span>
          <Button
            disabled={busy || !selected.length || batch.status !== "pending"}
            onClick={() => onConfirm(selected)}
          >
            <Check size={16} />
            {busy ? "Gravando…" : "Confirmar selecionados"}
          </Button>
        </div>
      </section>
    </div>
  );
}

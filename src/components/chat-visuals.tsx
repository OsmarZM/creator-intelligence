"use client";
import type { ChatVisual } from "@/lib/chat-visuals";
export function ChatVisuals({ visuals }: { visuals: ChatVisual[] }) {
  return (
    <div className="chat-visuals">
      {visuals.map((visual, index) => (
        <section className="chat-visual" key={index} aria-label={visual.title}>
          <h3>{visual.title}</h3>
          {visual.type === "stats" && (
            <dl className="chat-stats">
              {visual.items.map((item, i) => (
                <div key={i}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                  {item.detail && <small>{item.detail}</small>}
                </div>
              ))}
            </dl>
          )}
          {visual.type === "table" && (
            <div
              className="chat-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={visual.title}
            >
              <table>
                <thead>
                  <tr>
                    {visual.columns.map((column, i) => (
                      <th scope="col" key={i}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visual.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {visual.type === "bars" && (
            <ol className="chat-ranking">
              {visual.items.map((item, i) => {
                const maximum = Math.max(
                  1,
                  ...visual.items.map((v) => v.value),
                );
                const value =
                  new Intl.NumberFormat(
                    "pt-BR",
                    visual.unit === "BRL"
                      ? { style: "currency", currency: "BRL" }
                      : { maximumFractionDigits: 2 },
                  ).format(item.value) + (visual.unit === "percent" ? "%" : "");
                return (
                  <li key={i}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{value}</strong>
                    </div>
                    <span className="chat-bar-track" aria-hidden="true">
                      <span
                        style={{ width: `${(item.value / maximum) * 100}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {visual.type === "flow" && (
            <ol className="chat-flow">
              {visual.steps.map((step, i) => (
                <li key={i}>
                  <span className="flow-index">{i + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    {step.detail && <p>{step.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

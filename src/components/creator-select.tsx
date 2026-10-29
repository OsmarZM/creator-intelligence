"use client";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import type { Creator } from "@/lib/types";

const searchable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@/, "")
    .toLowerCase();
export default function CreatorSelect({
  creators,
  value,
  onChange,
  disabled,
}: {
  creators: Creator[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 260,
    maxHeight: 300,
  });
  const options = [{ id: "", name: "Todos os criadores" }, ...creators].filter(
    (option) => searchable(option.name).includes(searchable(query.trim())),
  );
  const selected =
    creators.find((creator) => creator.id === value)?.name ??
    "Todos os criadores";
  function show() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }
  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = input.current?.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const below = innerHeight - rect.bottom - 12,
        above = rect.top - 12;
      const height = Math.min(320, Math.max(120, below >= 180 ? below : above));
      const width = Math.min(Math.max(rect.width, 270), innerWidth - 24);
      setPosition({
        top:
          below >= 180 ? rect.bottom + 7 : Math.max(12, rect.top - height - 7),
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        width,
        maxHeight: height,
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !input.current?.parentElement?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id, open, query]);
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      setActive((index) =>
        Math.max(
          0,
          Math.min(
            options.length - 1,
            index + (event.key === "ArrowDown" ? 1 : -1),
          ),
        ),
      );
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (options[active]) choose(options[active].id);
    }
  }
  return (
    <>
      <div className="creator-filter creator-combobox" data-open={open}>
        {open ? <Search size={16} /> : <Users size={16} />}
        <input
          ref={input}
          role="combobox"
          aria-label="Selecionar criador"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && options[active] ? `${id}-${active}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={open ? query : selected}
          placeholder="Pesquisar criador…"
          onFocus={show}
          onClick={() => {
            if (!open) show();
          }}
          onBlur={(event) => {
            if (!popup.current?.contains(event.relatedTarget)) setOpen(false);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={keyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          className="creator-toggle"
          aria-label="Abrir lista de criadores"
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else {
              input.current?.focus();
              show();
            }
          }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="creator-options"
            style={{ position: "fixed", ...position }}
          >
            <span className="creator-search-hint">
              Digite para buscar um creator
            </span>
            <div
              id={`${id}-list`}
              role="listbox"
              aria-label="Criadores disponíveis"
            >
              {options.map((option, index) => (
                <div
                  key={option.id}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={option.id === value}
                  className={index === active ? "active" : ""}
                  onPointerMove={() => setActive(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.id)}
                >
                  <span>{option.name}</span>
                  {option.id === value && <Check size={15} />}
                </div>
              ))}
            </div>
            {!options.length && <p role="status">Nenhum criador encontrado.</p>}
          </div>,
          document.body,
        )}
    </>
  );
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ISRAEL_LOCALITIES } from "@/lib/israel-localities";

/**
 * City / locality picker: a text input that suggests from every recognised
 * locality in Israel (see lib/israel-localities.ts).
 *
 * Deliberately a combobox and not a `<select>`. A 1,271-entry select is
 * unusable on a phone, and free text still has to be accepted — a new or
 * renamed locality, or a spelling the CBS list does not carry, must never be
 * the reason someone cannot join the club. So the list suggests and the field
 * accepts whatever the customer settles on.
 *
 * Matching puts names that *start* with what was typed first, because that is
 * what someone typing "גד" is looking for, and only then names that contain it.
 * The rendered list is capped: past a couple of dozen rows nobody is reading,
 * and the DOM cost is real on a mid-range phone.
 */

const MAX_SUGGESTIONS = 30;

function rankMatches(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of ISRAEL_LOCALITIES) {
    if (name.startsWith(q)) starts.push(name);
    else if (name.includes(q)) contains.push(name);
    if (starts.length >= MAX_SUGGESTIONS) break;
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

type Props = {
  name: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
};

export default function CityField({ name, label, required = false, disabled = false }: Props) {
  const ids = useId();
  const inputId = `${ids}-city`;
  const listId = `${ids}-list`;
  const hintId = `${ids}-hint`;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => rankMatches(query), [query]);
  // An exact hit needs no menu — it would just cover the next field.
  const showList = open && matches.length > 0 && !(matches.length === 1 && matches[0] === query.trim());

  // A click anywhere else is a decision to stop choosing.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(name: string) {
    setQuery(name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!showList) {
        setOpen(true);
        setActive(0);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        const next = i + delta;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Enter" && showList && active >= 0) {
      // Only swallow Enter when a suggestion is actually highlighted, so the
      // form still submits normally otherwise.
      e.preventDefault();
      choose(matches[active]);
      return;
    }
    if (e.key === "Escape" && showList) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="form-group city-field" ref={wrapRef}>
      <label htmlFor={inputId}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        placeholder="גדרה"
        maxLength={50}
        required={required}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <span className="label-hint" id={hintId}>
        התחילו להקליד ובחרו מהרשימה — כל היישובים בישראל.
      </span>
      {showList && (
        <ul className="city-options" id={listId} role="listbox" ref={listRef}>
          {matches.map((cityName, i) => (
            <li
              key={cityName}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              // pointerdown, not click: the outside-click handler above runs on
              // pointerdown and would close the list before a click landed.
              onPointerDown={(e) => {
                e.preventDefault();
                choose(cityName);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {cityName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

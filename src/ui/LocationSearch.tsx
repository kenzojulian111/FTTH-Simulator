import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { searchPlaces, validatePlaceQuery, type GeocodingResult } from "../api/geocodingApi";

interface Props { onSelect: (result: GeocodingResult) => void; search?: (query: string, signal: AbortSignal) => Promise<GeocodingResult[]> }
type SearchState = "idle" | "loading" | "results" | "empty" | "error";

export function LocationSearch({ onSelect, search = searchPlaces }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const cacheRef = useRef(new Map<string, GeocodingResult[]>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    generationRef.current += 1;
    requestRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = query.trim().replace(/\s+/g, " ");
    const validation = validatePlaceQuery(normalized);
    if (validation) { setResults([]); setState("error"); setMessage(validation); return; }
    const key = normalized.toLowerCase();
    const cached = cacheRef.current.get(key);
    if (cached) { setResults(cached); setState(cached.length ? "results" : "empty"); setMessage(""); setActiveIndex(-1); return; }
    requestRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    const controller = new AbortController();
    requestRef.current = controller;
    const generation = ++generationRef.current;
    setState("loading"); setMessage(""); setResults([]); setActiveIndex(-1);
    // Search is explicitly submitted (never typeahead); short debounce absorbs
    // rapid duplicate submits and gives the user visible feedback.
    timerRef.current = setTimeout(() => {
      void search(normalized, controller.signal).then((items) => {
        if (generation !== generationRef.current || controller.signal.aborted) return;
        const valid = items.filter((item) => Array.isArray(item.coordinate) && item.coordinate.length === 2);
        cacheRef.current.set(key, valid);
        setResults(valid); setState(valid.length ? "results" : "empty");
      }).catch((error: unknown) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setState("error"); setMessage(error instanceof Error ? error.message : "Place search failed. Try again.");
      });
    }, 300);
  };

  const choose = (result: GeocodingResult) => { requestRef.current?.abort(); setState("idle"); setResults([]); setActiveIndex(-1); onSelect(result); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setActiveIndex((index) => (index + 1) % results.length); }
    if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1)); }
    if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]); }
    if (event.key === "Escape") { setResults([]); setState("idle"); setActiveIndex(-1); }
  };

  return <div className="location-search">
    <form className="location-search-form" onSubmit={submit} role="search">
      <label className="sr-only" htmlFor="map-place-search">Search places or addresses</label>
      <input id="map-place-search" type="search" value={query} maxLength={200} placeholder="Search place or address" autoComplete="off" aria-autocomplete="list" aria-controls="place-search-results" aria-activedescendant={activeIndex >= 0 ? `place-search-option-${activeIndex}` : undefined} aria-expanded={state === "results"} onChange={(event) => { setQuery(event.target.value); generationRef.current += 1; requestRef.current?.abort(); if (timerRef.current) clearTimeout(timerRef.current); setResults([]); setState("idle"); setMessage(""); }} onKeyDown={onKeyDown} />
      <button type="submit" disabled={state === "loading"}>{state === "loading" ? "Searching…" : "Search"}</button>
    </form>
    <div className="location-search-attribution">Search: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
    {state === "error" && <div className="place-search-status error" role="alert">{message}</div>}
    {state === "empty" && <div className="place-search-status" role="status">No places found. Try a more specific query.</div>}
    {state === "results" && <ul id="place-search-results" className="place-search-results" role="listbox" aria-label="Place search results">{results.map((result, index) => <li key={result.id}><button id={`place-search-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)}><strong>{result.displayName}</strong><small>{result.address ? `${result.address} · ` : ""}{result.coordinate[1].toFixed(5)}, {result.coordinate[0].toFixed(5)}</small></button></li>)}</ul>}
  </div>;
}

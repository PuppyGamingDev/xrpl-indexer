/** URL <-> list-state helpers shared by the Tokens & Collections explorer pages. */

export type SortDir = "asc" | "desc";

export interface ListState {
  sort: string;
  dir: SortDir;
  /** 1-based page number. */
  page: number;
  /** free-text search box value. */
  q: string;
  /** page-specific filters (type / verified / named ...). */
  extra: Record<string, string>;
}

type RawParams = Record<string, string | string[] | undefined>;

/** Parse the RSC `searchParams` object into a normalized ListState. */
export function readListState(
  sp: RawParams,
  o: { defaultSort: string; extraKeys?: readonly string[] },
): ListState {
  const g = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const extra: Record<string, string> = {};
  for (const k of o.extraKeys ?? []) {
    const v = g(k);
    if (v) extra[k] = v;
  }
  return {
    sort: g("sort") || o.defaultSort,
    dir: g("dir") === "asc" ? "asc" : "desc",
    page: Math.max(1, Number(g("page")) || 1),
    q: g("q") ?? "",
    extra,
  };
}

/** Build the upstream API query string from list state. `keyMap` renames extra keys. */
export function toApiQuery(st: ListState, pageSize: number, keyMap: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  p.set("sortBy", st.sort);
  p.set("order", st.dir);
  p.set("limit", String(pageSize));
  p.set("offset", String((st.page - 1) * pageSize));
  if (st.q) p.set("search", st.q);
  for (const [k, v] of Object.entries(st.extra)) {
    if (v) p.set(keyMap[k] ?? k, v);
  }
  return p.toString();
}

/**
 * Merge `patch` onto the current URL search params. Empty / false / null values
 * delete the key. Any change other than page-only resets `page` to 1.
 * Returns a leading-`?` search string (or "" when empty).
 */
export function nextSearch(
  current: URLSearchParams,
  patch: Record<string, string | number | boolean | null | undefined>,
): string {
  const p = new URLSearchParams(current.toString());
  const onlyPage = Object.keys(patch).length === 1 && Object.keys(patch)[0] === "page";
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || v === false) p.delete(k);
    else p.set(k, String(v));
  }
  if (!onlyPage) p.delete("page");
  const s = p.toString();
  return s ? `?${s}` : "";
}

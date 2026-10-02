"use client";

import { useEffect, useState } from "react";

import { tokenFromHash } from "./links";

export type HashToken =
  | { state: "reading" }
  | { state: "missing" }
  | { state: "found"; token: string };

/**
 * Reads the one-time token from an emailed link's fragment, then removes
 * the fragment from the address bar and history, so the token isn't left
 * behind in the browser after it has been used.
 */
export function useHashToken(): HashToken {
  const [result, setResult] = useState<HashToken>({ state: "reading" });
  useEffect(() => {
    const token = tokenFromHash(window.location.hash);
    if (window.location.hash !== "") {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
    // Reading the address bar is a one-off sync with the outside world.
    setResult(
      token === undefined ? { state: "missing" } : { state: "found", token },
    );
  }, []);
  return result;
}

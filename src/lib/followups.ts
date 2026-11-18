import { FOLLOWUP_CLOSE, FOLLOWUP_OPEN } from "./prompt";

// ---------- strips the <followups>[...]</followups> tail out of the text stream ----------
export class FollowupFilter {
  private pending = "";
  private captured: string | null = null;

  /** Returns text that is safe to show the visitor now. */
  push(delta: string): string {
    if (this.captured !== null) {
      this.captured += delta;
      return "";
    }
    this.pending += delta;
    const idx = this.pending.indexOf(FOLLOWUP_OPEN);
    if (idx >= 0) {
      const out = this.pending.slice(0, idx);
      this.captured = this.pending.slice(idx + FOLLOWUP_OPEN.length);
      this.pending = "";
      return out;
    }
    // Hold back a trailing fragment that could be the start of the marker.
    let keep = 0;
    for (let k = Math.min(FOLLOWUP_OPEN.length - 1, this.pending.length); k > 0; k--) {
      if (FOLLOWUP_OPEN.startsWith(this.pending.slice(-k))) {
        keep = k;
        break;
      }
    }
    const out = this.pending.slice(0, this.pending.length - keep);
    this.pending = this.pending.slice(this.pending.length - keep);
    return out;
  }

  /** Flushes held-back text and returns parsed follow-up questions. */
  end(): { rest: string; followups: string[] } {
    const rest = this.pending;
    this.pending = "";
    let followups: string[] = [];
    if (this.captured !== null) {
      const raw = this.captured.split(FOLLOWUP_CLOSE)[0].trim();
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          followups = parsed.filter((q): q is string => typeof q === "string").slice(0, 3);
        }
      } catch {
        /* model produced malformed suggestions — just skip them */
      }
    }
    return { rest, followups };
  }
}

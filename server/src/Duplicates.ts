/*
 * Catches the same booking arriving twice, in memory.
 *
 * A client who taps Submit twice, or reloads the confirmation page, sends the
 * form again byte for byte. Both copies used to land in the sheet as separate
 * requests, which is two identical cards on the dashboard and no way to tell
 * which one to act on. Two years of history had thirteen of these in it.
 *
 * Only an identical resubmission counts. Change any field, a time, a note, a
 * mistyped digit in the phone number, and it goes through as a new request,
 * because that is a client correcting themselves and the correction is the
 * thing worth keeping.
 *
 * Process-local for the same reason RateLimit.ts is: one Node process, and a
 * restart clearing a ten-minute window costs nothing.
 */

import type { IValidatedBooking } from "./Booking";

/* Trims, folds case and collapses runs of whitespace, so "After  4pm" and
   "after 4pm" fingerprint the same. Anything less and the guard misses the
   resubmission it exists to catch. */
const normalize = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

/* A unit separator cannot appear in form input, so no combination of fields
   can fingerprint the same as a different combination. */
const SEPARATOR = "\u001F";

export function fingerprint(booking: IValidatedBooking): string {
  return [
    booking.name, booking.email, booking.phone,
    booking.date1, booking.availability1,
    booking.date2, booking.availability2,
    booking.date3, booking.availability3,
    booking.description
  ].map(normalize).join(SEPARATOR);
}

export class DuplicateGuard {

  private seen = new Map<string, number>();
  private windowMs: number;
  /* Guards against unbounded growth, the same cap RateLimiter uses. */
  private maxKeys: number;

  constructor(windowMs: number = 10 * 60 * 1000, maxKeys: number = 10000) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /* Records the booking and reports whether an identical one arrived inside
     the window. Recording and checking are one call so there is no gap between
     them for a second request to slip through. */
  public isRepeat(booking: IValidatedBooking, now: number = Date.now()): boolean {
    this.evictExpired(now);

    const key = fingerprint(booking);
    const repeat = this.seen.has(key);

    if (!repeat && this.seen.size >= this.maxKeys) { this.seen.clear(); }
    /* The window runs from the latest attempt, so a client hammering submit
       cannot get a duplicate through by outlasting the original. */
    this.seen.set(key, now + this.windowMs);

    return repeat;
  }

  /* Drops a booking's fingerprint again, so a submission that failed on the way
     out does not make the client's retry look like a duplicate. */
  public forget(booking: IValidatedBooking): void {
    this.seen.delete(fingerprint(booking));
  }

  private evictExpired(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (now >= expiresAt) { this.seen.delete(key); }
    }
  }

  /* Test seam. */
  public reset(): void {
    this.seen.clear();
  }

}

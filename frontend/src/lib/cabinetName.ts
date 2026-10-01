/** One UTF-16 unit that .NET's char.IsLetterOrDigit accepts: a letter, or a decimal digit. */
const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;

/**
 * A cabinet name as the server compares it (Venue.Normalize): uppercased, with everything
 * but letters and decimal digits dropped, so "THE BASE 2" and "the-base 2" are one cabinet.
 * The wall and the venue editor both use it, so a name matches here exactly where it
 * would match a station alias there - test vectors both sides read hold the two together
 * (src/test/contract/cabinet-names.json).
 *
 * Written unit by unit, as the server's loop is, rather than with one regex and
 * toUpperCase over the string, because the two differ wherever Unicode is generous:
 * - Numbers that are not decimal digits are dropped: "Ⅱ" and "²" are no part of a name.
 * - A letter keeps its own case where its capital is two letters ("ß", "ﬁ"): the server
 *   uppercases one char into one char.
 * - Half of a surrogate pair is neither a letter nor a digit there, so a letter outside
 *   the Basic Multilingual Plane is dropped here too.
 */
export function normalizeCabinetName(name: string | null | undefined): string {
  const value = name ?? '';
  let key = '';
  for (let index = 0; index < value.length; index += 1) {
    const unit = value[index];
    if (LETTER_OR_DIGIT.test(unit)) {
      const upper = unit.toUpperCase();
      key += upper.length === 1 ? upper : unit;
    }
  }
  return key;
}

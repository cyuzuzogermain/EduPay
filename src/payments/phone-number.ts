/**
 * Loose, format-only check for "does this look like a phone number" - not a full E.164/
 * libphonenumber validator (deliberately, to avoid a new dependency for what's ultimately a
 * simulated flow: the number is captured for realism, never actually dialled or SMS'd).
 * Accepts an optional leading +, then 7-15 digits with optional interior spaces/hyphens.
 */
export const PHONE_NUMBER_PATTERN = /^\+?[0-9][0-9\s-]{6,14}$/;

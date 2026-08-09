import { z } from 'zod';

// Personal appearance + notification preferences — one row per user,
// never per organization (see schema.prisma's UserPreferences model
// comment for the full multi-tenancy reasoning). Every enum here is a
// closed, curated set on purpose: theme/accent/font/density are all
// "pick one of a small number of designed options," never free text or
// an arbitrary hex/URL — the backend rejects anything outside these sets
// the same way every other enum-backed contract in this codebase does.

// Values match schema.prisma's Theme/Accent/FontFamily/FontSize/Density
// enums verbatim — same convention as NotificationType/YellowZoneStatus/
// every other Prisma-enum-backed contract in this package, so the
// service layer never needs a case-translation table between "what the
// DB stores" and "what the wire sends."
export const themeSchema = z.enum(['SYSTEM', 'LIGHT', 'DARK']);
export type ThemeValue = z.infer<typeof themeSchema>;

// Five curated accents, all within Kinvo's existing navy/ocean identity —
// no arbitrary hex input. See index.css's [data-accent] blocks for the
// actual color values each of these maps to.
export const accentSchema = z.enum(['OCEAN', 'DEEP_BLUE', 'ELECTRIC_BLUE', 'TEAL', 'SLATE']);
export type AccentValue = z.infer<typeof accentSchema>;

// 'SYSTEM' (the default) means "whatever the browser/OS already renders" —
// Kinvo has never loaded a custom font, so this is what every existing
// user already sees; the other three are bundled locally via @fontsource
// (see main.tsx's font imports), never fetched from a remote URL at
// runtime.
export const fontFamilySchema = z.enum(['SYSTEM', 'INTER', 'PLUS_JAKARTA_SANS', 'DM_SANS']);
export type FontFamilyValue = z.infer<typeof fontFamilySchema>;

export const fontSizeSchema = z.enum(['SMALL', 'DEFAULT', 'LARGE', 'EXTRA_LARGE']);
export type FontSizeValue = z.infer<typeof fontSizeSchema>;

export const densitySchema = z.enum(['COMPACT', 'COMFORTABLE', 'SPACIOUS']);
export type DensityValue = z.infer<typeof densitySchema>;

export const settingsSchema = z.object({
  theme: themeSchema,
  accent: accentSchema,
  fontFamily: fontFamilySchema,
  fontSize: fontSizeSchema,
  density: densitySchema,
  reducedMotion: z.boolean(),
  // The only preference with real backend enforcement — see
  // voice.service.ts's recipient query. The rest of this object is
  // presentation-only, applied entirely on the client.
  yellowZoneEscalationNotifications: z.boolean(),
  notificationSound: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

// Every field optional — PATCH semantics, not PUT: a client changing just
// the theme sends `{ theme: 'dark' }`, not the full object back. `.strict()`
// isn't used here (matching this codebase's other update schemas) since
// Zod already rejects any field whose VALUE doesn't match one of the
// closed enums above; an unknown key is simply ignored by
// `.partial()`'s shape, not a validation gap this contract needs to guard
// beyond what the enums themselves already enforce.
export const updateSettingsRequestSchema = settingsSchema.partial();
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/**
 * Simple class name combiner — joins truthy strings with spaces.
 * Avoids the need for clsx/tailwind-merge in this project.
 */
export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}

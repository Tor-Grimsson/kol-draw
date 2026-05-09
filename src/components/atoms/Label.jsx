/**
 * Label — minimal form label. Inherits typography from parent (consumer
 * supplies `kol-helper-N` or similar via className when needed). Defaults
 * to `text-fg-48` for the muted-control look.
 */
export default function Label({ children, htmlFor, className = '' }) {
  return (
    <label htmlFor={htmlFor} className={`text-fg-48 ${className}`}>
      {children}
    </label>
  )
}

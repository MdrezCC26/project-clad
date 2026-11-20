import type { OrderLineNoteText } from "../utils/orderLineNote";

function NoteIcon() {
  return (
    <svg
      className="project-clad-order-line-note__icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 1.5h5.5L13 5v9.5H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 1.5V5H13M6 8h5M6 10.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Full-width note callouts under an order line tile. Renders nothing without notes. */
export function OrderLineNoteBox({ notes }: { notes: OrderLineNoteText[] }) {
  if (!notes.length) return null;
  return (
    <>
      {notes.map((note) => (
        <section
          key={note.key}
          className="project-clad-order-line-note"
          data-projectclad-order-line-note=""
          aria-label="Note"
        >
          <div className="project-clad-order-line-note__head">
            <NoteIcon />
            <span className="project-clad-order-line-note__label">Note</span>
          </div>
          <div className="project-clad-order-line-note__body">
            {note.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

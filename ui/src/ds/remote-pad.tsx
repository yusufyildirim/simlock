import "./remote-pad.css";

export interface PadKey {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

export interface Pad {
  readonly up: PadKey;
  readonly down: PadKey;
  readonly left: PadKey;
  readonly right: PadKey;
  readonly center: PadKey;
}

// why: an arrow glyph names nothing to a screen reader, so each pad key carries its label as its
// accessible name and the glyph is hidden.
const ARROWS: Readonly<Record<"up" | "down" | "left" | "right", string>> = {
  down: "M4 6l4 4 4-4",
  left: "M10 4L6 8l4 4",
  right: "M6 4l4 4-4 4",
  up: "M4 10l4-4 4 4",
};

function Arrow(props: { readonly direction: keyof typeof ARROWS; readonly entry: PadKey }) {
  const { direction, entry } = props;
  return (
    <button
      type="button"
      aria-label={entry.label}
      className={`remote-pad-key remote-pad-${direction}`}
      disabled={entry.disabled}
      onClick={entry.onPress}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
        <path d={ARROWS[direction]} fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </button>
  );
}

// why: a TV remote is a ring of four arrows round a centre key, then a row of plain buttons; a
// device with no pad gets only the row.
export function RemotePad(props: { readonly pad?: Pad; readonly keys: readonly PadKey[] }) {
  const { keys, pad } = props;
  return (
    <div className="remote-pad">
      {pad === undefined ? null : (
        <div className="remote-pad-ring">
          <Arrow direction="up" entry={pad.up} />
          <Arrow direction="left" entry={pad.left} />
          <button
            type="button"
            className="remote-pad-key remote-pad-center"
            disabled={pad.center.disabled}
            onClick={pad.center.onPress}
          >
            {pad.center.label}
          </button>
          <Arrow direction="right" entry={pad.right} />
          <Arrow direction="down" entry={pad.down} />
        </div>
      )}
      <div className="remote-pad-row">
        {keys.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className="button button-secondary button-sm"
            disabled={entry.disabled}
            onClick={entry.onPress}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

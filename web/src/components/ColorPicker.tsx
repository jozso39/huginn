import type { CSSProperties } from 'react';
import { CONNECTION_COLORS, tint } from '../colors';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

const swatch = (color: string) => ({ '--swatch': color }) as CSSProperties;

/**
 * The colour a connection's items are tinted with. The inbox only mixes a little of
 * it into its background, so even a loud pick ends up a calm, readable shade.
 */
export const ColorPicker = ({ value, onChange }: ColorPickerProps) => {
  const current = value.toLowerCase();
  const custom = !CONNECTION_COLORS.some((entry) => entry.color === current);

  return (
    <div className="colors">
      <div className="colors__swatches" role="radiogroup" aria-label="Colour">
        {CONNECTION_COLORS.map(({ color, name }) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={current === color}
            aria-label={name}
            title={name}
            className={current === color ? 'swatch swatch--on' : 'swatch'}
            style={swatch(color)}
            onClick={() => onChange(color)}
          />
        ))}
        <label
          className={custom ? 'swatch swatch--custom swatch--on' : 'swatch swatch--custom'}
          style={custom ? swatch(current) : undefined}
          title="Any other colour"
        >
          <input
            type="color"
            aria-label="Any other colour"
            value={current}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </div>
      <div className="colors__preview" style={tint(current)}>
        Its messages look like this in the inbox
      </div>
    </div>
  );
};

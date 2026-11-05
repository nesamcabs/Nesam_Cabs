import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface SwipeProps {
  label: string;
  /** Resolve true (or void) when the action succeeded, false to reset the slider. A thrown error also resets it. */
  onCommit: () => Promise<boolean | void>;
  disabled?: boolean;
  /** An action is already in flight elsewhere on the screen. */
  busy?: boolean;
}

const THRESHOLD = 96;
const GRAB_ZONE_PX = 60;

/**
 * The reference's slide-to-confirm control: a transparent range input over a knob. The drag must begin on the knob
 * (first 60px), release at 96% or more commits, anything shorter springs back, and keyboard users focus the slider and
 * press End. While the action runs the knob stays down and turns green; a failure puts it back so it can be retried.
 */
export const Swipe: React.FC<SwipeProps> = ({ label, onCommit, disabled = false, busy = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(0);
  const [complete, setComplete] = useState(false);
  const valueRef = useRef(0);
  const pointer = useRef(false);
  const running = useRef(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const inactive = disabled || busy;
  const inactiveRef = useRef(inactive);
  inactiveRef.current = inactive;

  const set = (v: number) => {
    valueRef.current = v;
    setValue(v);
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    const reset = () => {
      valueRef.current = 0;
      setValue(0);
    };
    const finish = async () => {
      if (running.current || inactiveRef.current) return;
      if (valueRef.current >= THRESHOLD) {
        running.current = true;
        setComplete(true);
        let ok = false;
        try {
          ok = (await commit.current()) !== false;
        } catch {
          ok = false;
        }
        if (!ok) {
          running.current = false;
          setComplete(false);
          reset();
        }
      } else if (pointer.current) {
        reset();
      }
    };
    const onChange = () => void finish();
    const onUp = () => {
      void finish();
      pointer.current = false;
    };
    const onDown = (e: PointerEvent) => {
      if (e.clientX - el.getBoundingClientRect().left > GRAB_ZONE_PX) {
        e.preventDefault();
        reset();
        return;
      }
      pointer.current = true;
    };
    const onKey = () => {
      pointer.current = false;
    };
    const onCancel = () => {
      if (!running.current) reset();
      pointer.current = false;
    };
    el.addEventListener('change', onChange);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('change', onChange);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, []);

  const knobLeft = `calc(${value}% + ${4 - 0.56 * value}px)`;
  const labelOpacity = Math.max(0.15, 1 - value / 80);
  return (
    <div className={`nx-swipe ${disabled ? 'is-disabled' : ''} ${complete ? 'is-complete' : ''}`}>
      <span className="nx-swipe-label" style={{ opacity: labelOpacity }}>
        {label}
      </span>
      <span className="nx-knob" style={{ left: knobLeft }} aria-hidden="true">
        <Icon name="chevron" />
      </span>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        aria-label={label}
        aria-describedby="flow-swipe-help"
        aria-valuetext={value >= THRESHOLD ? 'Release to confirm' : `${value} percent`}
        aria-busy={complete || busy}
        disabled={inactive}
      />
    </div>
  );
};

/** Screen-reader help the sliders point at; rendered once per trip page. */
export const SwipeHelp: React.FC = () => (
  <span id="flow-swipe-help" className="sr-only">
    Drag right to confirm, or focus the slider and press End.
  </span>
);

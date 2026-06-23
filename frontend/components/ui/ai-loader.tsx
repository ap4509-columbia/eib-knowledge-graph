"use client";

// Adapted from a component Alexandra found. Changes:
//   - Keyframes moved to globals.css (styled-jsx is fragile in App Router)
//   - Default size shrunk from 180 → 88 so it fits inside a chat bubble
//   - Removed the full-screen fixed overlay wrapper; component is now embeddable
//   - Removed the dark-mode inversion (we're always dark)

import * as React from "react";
import { cn } from "@/lib/utils";

interface AILoaderProps {
  /** Diameter in px. Default 88. */
  size?: number;
  /** Animated text inside the circle. Default "Thinking". */
  text?: string;
  /** Wrapper class. */
  className?: string;
}

export const AILoader: React.FC<AILoaderProps> = ({
  size = 88,
  text = "Thinking",
  className,
}) => {
  const letters = React.useMemo(() => text.split(""), [text]);

  return (
    <div
      className={cn(
        "relative flex select-none items-center justify-center font-medium tracking-tight",
        className
      )}
      style={{ width: size, height: size }}
      role="status"
      aria-label={text}
    >
      {letters.map((letter, i) => (
        <span
          key={i}
          className="inline-block animate-ai-loader-letter text-white/40"
          style={{
            animationDelay: `${i * 0.1}s`,
            fontSize: Math.max(11, size * 0.13),
          }}
        >
          {letter}
        </span>
      ))}
      <div className="absolute inset-0 animate-ai-loader-circle rounded-full" />
    </div>
  );
};

"use client";

// Adapted from the chat input design Alexandra found.
// Changes from the original:
//   - Removed Figma-only imports (figma:react, defineProperties)
//   - Converted dynamic Tailwind classes (e.g. bg-[${textColor}]/10) to inline
//     styles — Tailwind 4 JIT can't resolve runtime-interpolated class names
//   - Dropped the Auto/Max/Search/Plan menu (ChatGPT-mode picker; not relevant)
//   - Re-themed for dark background
//   - Removed sticky/centered positioning so it embeds inside a panel

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Position {
  x: number;
  y: number;
}

interface RippleEffect {
  x: number;
  y: number;
  id: number;
}

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Intensity of the glow effect (0.1 to 1.0). Default 0.4 */
  glowIntensity?: number;
  /** Animation duration in ms. Default 400 */
  animationDuration?: number;
  /** Whether to show the visual flourishes (glow, ripples). Default true */
  showEffects?: boolean;
}

// ── Glow effects ───────────────────────────────────────────────────────

const GlowEffects = memo(function GlowEffects({
  glowIntensity,
  mousePosition,
}: {
  glowIntensity: number;
  mousePosition: Position;
}) {
  return (
    <>
      {/* Border glow on hover/focus */}
      <div
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          boxShadow: `
            0 0 0 1px rgba(147, 51, 234, ${0.25 * glowIntensity}),
            0 0 12px rgba(147, 51, 234, ${0.35 * glowIntensity}),
            0 0 20px rgba(236, 72, 153, ${0.2 * glowIntensity}),
            0 0 28px rgba(59, 130, 246, ${0.15 * glowIntensity})
          `,
          filter: "blur(0.5px)",
        }}
      />
      {/* Cursor-following gradient */}
      <div
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-30 group-focus-within:opacity-40"
        style={{
          background: `radial-gradient(circle 140px at ${mousePosition.x}% ${mousePosition.y}%, rgba(147,51,234,0.18) 0%, rgba(236,72,153,0.12) 30%, rgba(59,130,246,0.08) 60%, transparent 100%)`,
        }}
      />
    </>
  );
});

// ── Ripple ─────────────────────────────────────────────────────────────

const RippleEffects = memo(function RippleEffects({
  ripples,
}: {
  ripples: RippleEffect[];
}) {
  if (ripples.length === 0) return null;
  return (
    <>
      {ripples.map((r) => (
        <div
          key={r.id}
          className="pointer-events-none absolute blur-sm"
          style={{
            left: r.x - 25,
            top: r.y - 25,
            width: 50,
            height: 50,
          }}
        >
          <div className="h-full w-full animate-ping rounded-full bg-gradient-to-r from-purple-400/20 via-pink-400/15 to-blue-400/20" />
        </div>
      ))}
    </>
  );
});

// ── Main component ─────────────────────────────────────────────────────

export function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Ask about the knowledge graph…",
  className,
  glowIntensity = 0.4,
  animationDuration = 400,
  showEffects = true,
}: PromptInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const throttleRef = useRef<number | null>(null);

  const [mousePosition, setMousePosition] = useState<Position>({ x: 50, y: 50 });
  const [ripples, setRipples] = useState<RippleEffect[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 22;
    const maxHeight = lineHeight * 6 + 16;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [value]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !disabled) onSubmit(trimmed);
    },
    [value, onSubmit, disabled]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed && !disabled) onSubmit(trimmed);
      }
    },
    [value, onSubmit, disabled]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!showEffects) return;
      if (throttleRef.current) return;
      throttleRef.current = window.setTimeout(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          setMousePosition({ x, y });
        }
        throttleRef.current = null;
      }, 50);
    },
    [showEffects]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!showEffects) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const id = Date.now();
      const next: RippleEffect = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        id,
      };
      setRipples((prev) => (prev.length >= 4 ? prev : [...prev, next]));
      window.setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);
    },
    [showEffects]
  );

  const isSubmitDisabled = disabled || !value.trim();

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)}>
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        className={cn(
          "group relative flex w-full items-end gap-2 rounded-3xl border border-zinc-800 bg-zinc-900/60 p-2 shadow-lg backdrop-blur-xl transition-colors",
          "hover:bg-zinc-900/70 focus-within:bg-zinc-900/80"
        )}
        style={{ transitionDuration: `${animationDuration}ms` }}
      >
        {showEffects && (
          <>
            <GlowEffects
              glowIntensity={glowIntensity}
              mousePosition={mousePosition}
            />
            <RippleEffects ripples={ripples} />
          </>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Chat input"
          rows={1}
          disabled={disabled}
          className={cn(
            "relative z-10 max-h-40 min-h-8 flex-1 resize-none self-center bg-transparent",
            "px-2 py-1 text-sm leading-[22px] text-zinc-100 outline-none",
            "placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
          )}
          style={{ letterSpacing: "-0.14px" }}
        />

        <button
          type="submit"
          disabled={isSubmitDisabled}
          aria-label="Send message"
          className={cn(
            "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition",
            isSubmitDisabled
              ? "cursor-not-allowed bg-zinc-800 text-zinc-600"
              : "bg-zinc-100 text-zinc-900 hover:bg-white"
          )}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}

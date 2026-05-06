import clsx from "clsx";

export function Button({
  className,
  variant = "primary",
  loading = false,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "danger" | "plain"; loading?: boolean }) {
  return (
    <button
      className={clsx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-none px-3.5 py-2.5 text-sm font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border border-emerald-700/70 bg-[linear-gradient(180deg,#27b27f_0%,#1f9d72_100%)] text-white shadow-[0_12px_24px_rgba(31,157,114,0.18)] hover:translate-y-[-1px] hover:brightness-[1.03]",
        variant === "soft" && "border border-[var(--line)] bg-white/90 text-[var(--text)] shadow-[0_8px_20px_rgba(28,54,40,0.06)] hover:bg-[var(--bg-soft)]",
        variant === "danger" && "border border-red-700/70 bg-[linear-gradient(180deg,#ef5d5d_0%,#dc3c3c_100%)] text-white shadow-[0_10px_22px_rgba(220,60,60,0.16)] hover:brightness-[1.03]",
        variant === "plain" && "text-[var(--muted)] hover:bg-white/70 hover:text-[var(--text)]",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin border-2 border-current border-r-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx("w-full rounded-none border border-[var(--line)] bg-white/90 px-3.5 py-2.5 text-sm text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none placeholder:text-[var(--muted)]/80 focus:border-emerald-500 focus:bg-white", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx("w-full rounded-none border border-[var(--line)] bg-white/90 px-3.5 py-2.5 text-sm text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none focus:border-emerald-500 focus:bg-white", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx("w-full rounded-none border border-[var(--line)] bg-white/90 px-3.5 py-2.5 text-sm text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none placeholder:text-[var(--muted)]/80 focus:border-emerald-500 focus:bg-white", props.className)} />;
}

export function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "red" | "slate" | "purple" }) {
  const tones = { blue: "bg-sky-50 text-sky-700 ring-1 ring-sky-100", green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100", amber: "bg-lime-50 text-lime-700 ring-1 ring-lime-100", red: "bg-red-50 text-red-700 ring-1 ring-red-100", slate: "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80", purple: "bg-violet-50 text-violet-700 ring-1 ring-violet-100" };
  return <span className={clsx("inline-flex rounded-none px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em]", tones[tone])}>{children}</span>;
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="court-shell overflow-hidden rounded-none border border-[var(--line)] bg-[var(--surface)] shadow-[0_14px_30px_rgba(18,41,28,0.06)] backdrop-blur-sm"><div className="flex items-center justify-between gap-2 border-b border-[var(--line)]/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.82)_0%,rgba(245,249,242,0.9)_100%)] px-3 py-2"><h2 className="text-sm font-bold tracking-[0.01em] text-[var(--text)]">{title}</h2>{action}</div><div className="p-3">{children}</div></section>;
}

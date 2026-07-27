"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
          <section className="w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-sm)]">
            <p className="text-sm font-medium text-[var(--primary)]">SelahKeep</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">A quiet pause</h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              The application could not establish a safe first frame. Retry to resolve your account state.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 min-h-11 rounded-[var(--radius)] bg-[var(--primary-solid)] px-4 text-sm font-medium text-[var(--on-primary)]"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}

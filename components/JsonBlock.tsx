export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-ink-2">{label}</p>
      <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-xs leading-5 text-ink">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

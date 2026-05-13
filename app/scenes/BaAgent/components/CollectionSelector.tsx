import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { OutlineCollection } from "../type";
import { listCollections } from "../api";

type Props = {
  value: string;
  onChange: (id: string) => void;
};

export default function CollectionSelector({ value, onChange }: Props) {
  const [collections, setCollections] = useState<OutlineCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    listCollections()
      .then((data) => {
        setCollections(data);
        if (data.length > 0 && !value) { onChange(data[0].id); }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-xs text-slate-400 dark:text-slate-500">Loading collections…</p>;
  }

  if (error) {
    return <p className="text-xs text-red-400">Failed to load collections.</p>;
  }

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 pr-8 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

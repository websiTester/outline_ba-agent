import { useRef, useState } from "react";

const ACCEPTED_EXTENSIONS = [".docx", ".txt", ".md"];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
}

function FileUploadSection({ file, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function validate(f: File): string | null {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported format "${ext}". Accepted: .docx, .txt, .md`;
    }
    if (f.size > MAX_SIZE_BYTES) {
      return `File exceeds 50 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`;
    }
    return null;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) { return; }
    const err = validate(selected);
    if (err) {
      setError(err);
      onChange(null);
    } else {
      setError(null);
      onChange(selected);
    }
    e.target.value = "";
  }

  function handleRemove() {
    setError(null);
    onChange(null);
    if (inputRef.current) { inputRef.current.value = ""; }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={handleFileChange}
      />

      {file ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5">
          {/* File icon */}
          <svg
            className="w-4 h-4 text-blue-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
          <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 truncate">
            {file.name}
          </span>
          <span className="text-xs text-slate-400 flex-shrink-0">
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </span>
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Remove file"
            className="flex-shrink-0 text-slate-300 hover:text-slate-500 dark:hover:text-slate-300 transition-colors duration-150 cursor-pointer"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-slate-800 transition-colors duration-150 px-6 py-9 flex flex-col items-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
        >
          <svg
            className="w-7 h-7 text-blue-300 dark:text-blue-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Click to upload
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            .docx · .txt · .md &nbsp;—&nbsp; max 50 MB
          </span>
        </button>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-400 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

export default FileUploadSection;

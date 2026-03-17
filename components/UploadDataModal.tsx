"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

interface UploadDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  projectId: string;
}

export function UploadDataModal({ isOpen, onClose, jobId, projectId }: UploadDataModalProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  async function handleUpload() {
    if (!file) {
      toast.error("Please select a file");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("jobId", jobId);
    formData.append("projectId", projectId);

    try {
      const response = await fetch(`/api/projects/${projectId}/research/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      toast.success(`Added ${data.rowsAdded} rows from uploaded file`);
      onClose();
      router.refresh();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        zIndex: 9999,
      }}
    >
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        className="relative bg-panel border border-line rounded-lg p-6 max-w-md w-full shadow-panel backdrop-blur-panel"
        style={{
          position: "relative",
          zIndex: 10,
        }}
      >
        <h2 className="text-xl font-bold mb-4">Upload Market Research</h2>

        <p className="text-sm text-muted mb-4">
          Upload additional market research in CSV, TXT, PDF, DOCX, or JSON format.
          The content will be parsed and added to your existing audience and product research.
        </p>

        <input
          type="file"
          accept=".csv,.txt,.pdf,.docx,.json"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-muted
            file:mr-4 file:py-2 file:px-4
            file:rounded-pill file:border-0
            file:text-sm file:font-semibold
            file:bg-accent file:text-bg
            hover:file:bg-accent/90
            transition-all
            mb-4"
        />

        {file && (
          <p className="text-sm text-muted mb-4 font-mono">
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}

        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 bg-bg-elevated hover:bg-panel-strong border border-line rounded-pill text-sm text-muted hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="px-4 py-2 bg-accent hover:bg-accent/90 text-bg font-semibold disabled:opacity-50 disabled:cursor-not-allowed rounded-pill text-sm transition-all shadow-[0_0_15px_rgba(232,209,122,0.2)]"
          >
            {uploading ? "Uploading..." : "Upload & Add Data"}
          </button>
        </div>
      </div>
    </div>
  );
}

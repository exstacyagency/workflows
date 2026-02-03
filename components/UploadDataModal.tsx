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
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full"
        style={{
          position: "relative",
          zIndex: 10,
        }}
      >
        <h2 className="text-xl font-bold mb-4">Upload Research Data</h2>

        <p className="text-sm text-slate-400 mb-4">
          Upload additional research data in CSV, TXT, PDF, DOCX, or JSON format.
          The content will be parsed and added to your existing research.
        </p>

        <input
          type="file"
          accept=".csv,.txt,.pdf,.docx,.json"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-400
            file:mr-4 file:py-2 file:px-4
            file:rounded file:border-0
            file:text-sm file:font-medium
            file:bg-sky-600 file:text-white
            hover:file:bg-sky-500
            mb-4"
        />

        {file && (
          <p className="text-sm text-slate-400 mb-4">
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
          >
            {uploading ? "Uploading..." : "Upload & Add Data"}
          </button>
        </div>
      </div>
    </div>
  );
}

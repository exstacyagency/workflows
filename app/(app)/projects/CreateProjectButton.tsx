"use client";

export default function CreateProjectButton() {
  async function handleCreate() {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // ⬅️ REQUIRED
      body: JSON.stringify({
        name: "Alpha Test Project",
        description: "Created from Studio UI",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Create project failed:", res.status, text);
      alert("Failed to create project");
      return;
    }

    window.location.reload();
  }

  return (
    <button onClick={handleCreate}>
      Create Project
    </button>
  );
}

"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

type IdentifierType = 'amazon_asin' | 'g2_url' | 'local_business' | 'none';

type IdentifierOption = {
  value: IdentifierType;
  label: string;
  inputLabel?: string;
  inputPlaceholder?: string;
};

const IDENTIFIER_OPTIONS: IdentifierOption[] = [
  {
    value: 'amazon_asin',
    label: 'Amazon (physical products)',
    inputLabel: 'Amazon ASIN',
    inputPlaceholder: 'B07XYZ1234'
  },
  {
    value: 'g2_url',
    label: 'G2 (SaaS/software)',
    inputLabel: 'G2 Product URL',
    inputPlaceholder: 'https://www.g2.com/products/slack/reviews'
  },
  {
    value: 'local_business',
    label: 'Google/Yelp (local business)',
    inputLabel: 'Business Name & Location',
    inputPlaceholder: "Tony's Pizza, New York, NY"
  },
  {
    value: 'none',
    label: 'No reviews yet'
  }
];

export default function CustomerResearchPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = typeof params?.projectId === "string" ? params.projectId : "";
  if (!params || !params.projectId) {
    throw new Error("Missing projectId param");
  }

  const projectId = params.projectId;

  // Form state
  const [offeringName, setOfferingName] = useState('');
  const [valueProp, setValueProp] = useState('');
  const [identifierType, setIdentifierType] = useState<IdentifierType | ''>('');
  const [identifier, setIdentifier] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!projectId) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-red-300">Project not found.</p>
      </div>
    );
  }

  // Get current identifier option config
  const selectedOption = IDENTIFIER_OPTIONS.find(opt => opt.value === identifierType);
  const needsIdentifier = identifierType && identifierType !== 'none';

  // Form validation
  const isValid =
    offeringName.trim() !== '' &&
    valueProp.trim() !== '' &&
    identifierType !== '' &&
    (!needsIdentifier || identifier.trim() !== '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!isValid) {
      setError('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: any = {
        projectId,
        offeringName: offeringName.trim(),
        valueProp: valueProp.trim(),
        identifierType
      };

      // Only include identifier if needed
      if (needsIdentifier) {
        payload.identifier = identifier.trim();
      }

      const res = await fetch('/api/jobs/customer-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to start research');
      }

      const data = await res.json();
      setSuccess(true);

      // Redirect to project page after short delay
      setTimeout(() => {
        router.push(`/projects/${projectId}`);
      }, 2000);

    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to start research');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="px-6 py-6 space-y-6">
        <section className="rounded-xl border border-green-800 bg-green-900/20 p-8 text-center">
          <div className="text-green-400 text-2xl mb-2">✓</div>
          <h1 className="text-xl font-semibold text-green-50 mb-2">Research Started!</h1>
          <p className="text-sm text-green-300">
            Your customer research job is now running. Redirecting you back to the project...
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-2xl">
      {/* Header */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
        <h1 className="text-2xl font-semibold text-slate-50">Customer Research</h1>
        <p className="text-sm text-slate-300 mt-1">
          Collect authentic customer feedback from Reddit and review platforms to fuel your video scripts.
        </p>
      </section>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 1: Basic Info */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 mb-3">Step 1: Basic Information</h2>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-300">
              Offering Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={offeringName}
              onChange={(e) => setOfferingName(e.target.value)}
              placeholder="e.g. ClearGlow Acne Serum"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-300">
              Value Proposition <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={valueProp}
              onChange={(e) => setValueProp(e.target.value)}
              placeholder="What problem does this solve?"
            />
            <p className="text-xs text-slate-500 mt-1">
              Example: &ldquo;persistent acne and scarring&rdquo; or &ldquo;team communication&rdquo;
            </p>
          </div>
        </section>

        {/* Step 2: Review Platform */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 mb-3">Step 2: Review Platform</h2>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-300">
              Where do customers review you? <span className="text-red-400">*</span>
            </label>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={identifierType}
              onChange={(e) => {
                setIdentifierType(e.target.value as IdentifierType);
                setIdentifier(''); // Clear identifier when changing type
              }}
            >
              <option value="">Select a platform...</option>
              {IDENTIFIER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Step 3: Conditional Identifier Input */}
        {selectedOption && needsIdentifier && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100 mb-3">Step 3: Identifier</h2>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                {selectedOption.inputLabel} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={selectedOption.inputPlaceholder}
              />
            </div>
          </section>
        )}

        {/* Step 4: Submit */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-3">
          {/* Error Display */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {submitting && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {submitting ? 'Starting Research...' : 'Start Research'}
          </button>

          {/* Validation Helper */}
          {!isValid && offeringName && valueProp && identifierType && (
            <p className="text-xs text-slate-400 text-center">
              {needsIdentifier && !identifier.trim()
                ? `Please provide your ${selectedOption?.inputLabel?.toLowerCase()}`
                : 'Please fill in all required fields'}
            </p>
          )}
        </section>
      </form>

      {/* Info Box */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
        <h3 className="text-xs font-semibold text-slate-300 mb-2">What happens next?</h3>
        <ul className="text-xs text-slate-400 space-y-1">
          <li>• Reddit scraper searches for mentions of your offering and problem</li>
          {identifierType === 'amazon_asin' && (
            <li>• Amazon scraper collects product reviews</li>
          )}
          {identifierType === 'g2_url' && (
            <li>• G2 scraper collects software reviews</li>
          )}
          {identifierType === 'local_business' && (
            <>
              <li>• Google Business scraper collects reviews</li>
              <li>• Yelp scraper collects reviews</li>
            </>
          )}
          {identifierType === 'none' && (
            <li>• Only Reddit data will be collected (no review platform)</li>
          )}
          <li>• All results are stored in your project&rsquo;s research database</li>
          <li>• You&rsquo;ll be able to view and use this data in Phase 1B (Customer Analysis)</li>
        </ul>
      </section>
    </div>
  );
}
